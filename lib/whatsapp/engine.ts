import "server-only";
import { getServiceClient } from "@/lib/supabase-server";
import { validateDraft, EVENT_TYPES } from "@/lib/whatsapp/validators";
import { callDeepseekDraft } from "@/lib/whatsapp/deepseek";
import { getWhatsappConfig } from "@/lib/whatsapp/config";
import { isDateInCurrentWeek } from "@/lib/whatsapp/dates";
import { detectLocalDraft, isFallbackText } from "@/lib/whatsapp/intent";
import { LINK_INSTRUCTIONS, HELP_TEXT, FALLBACK_TEXT, formatConfirmSummary, ambiguousChoices } from "@/lib/whatsapp/format";
import { getIdentityByPhone, upsertIdentity, findValidChallengeByHash, findValidChallengeByUserId, markChallengeUsed, getConversation, upsertConversation, setPending, clearPending, isExpired } from "@/lib/whatsapp/store";
import { scheduleSessions as localScheduleSessions, subjects as localSubjects } from "@/lib/schedule-data";

type EngineResult = { reply: string; handled: boolean };

function isConfirmText(t: string): "yes" | "no" | null {
  const v = t.trim().toLowerCase();
  if (["si", "sí", "confirmar", "confirmo", "yes"].includes(v)) return "yes";
  if (["no", "cancelar", "cancelo"].includes(v)) return "no";
  return null;
}

function isNumericChoice(t: string): number | null {
  const v = t.trim();
  if (!/^\d+$/.test(v)) return null;
  const n = parseInt(v, 10);
  if (n < 1 || n > 10) return null;
  return n;
}

async function readSubjects(svc: ReturnType<typeof getServiceClient>) {
  const { data } = await svc.from("subjects").select("id, code, name, accent").order("code");
  if (data && data.length > 0) return data as Array<{ id: string; code: string; name: string; accent: string }>;
  return localSubjects;
}

async function readSchedulesForSubject(svc: ReturnType<typeof getServiceClient>, subjectId: string | null) {
  const select = "id, subject_id, day, start_time, end_time, section, subjects(id, code, name, accent), professors(display_name), rooms(name)";
  const localRows = localScheduleSessions
    .filter((session) => !subjectId || session.subjectId === subjectId)
    .flatMap((session) => {
      const subject = localSubjects.find((item) => item.id === session.subjectId);
      if (!subject) return [];
      return [{
        id: session.id,
        subject_id: session.subjectId,
        day: session.day,
        start_time: session.start,
        end_time: session.end,
        section: session.section,
        subjects: subject,
        professors: { display_name: session.professor },
        rooms: { name: session.room },
      }];
    });
  if (!subjectId) {
    const { data } = await svc.from("schedules").select(select).order("day").order("start_time").limit(100);
    return data && data.length > 0 ? data : localRows;
  }
  const { data } = await svc.from("schedules").select(select).eq("subject_id", subjectId).order("day").order("start_time");
  return data && data.length > 0 ? data : localRows;
}

async function readNotes(svc: ReturnType<typeof getServiceClient>, userId: string, subjectId?: string | null, query?: string) {
  let q = svc.from("notes").select("id, subject_id, title, content, note_date, tags, status, created_at, author_id, subjects(code)").order("created_at", { ascending: false }).limit(20);
  if (subjectId) q = q.eq("subject_id", subjectId);
  // show shared notes? All notes are readable via RLS true, but we filter to include all? For MVP, show all notes (shared)
  const { data } = await q;
  let rows = (data ?? []) as Array<Record<string, unknown>>;
  if (query) {
    const lower = query.toLowerCase();
    rows = rows.filter((r) => String(r.title ?? "").toLowerCase().includes(lower) || String(r.content ?? "").toLowerCase().includes(lower));
  }
  return rows;
}

async function readEvents(svc: ReturnType<typeof getServiceClient>) {
  const { data } = await svc.from("academic_events").select("id, title, type, date, time, subject_id, description, status, created_by, event_type, completed_by, completed_at, subjects(code)").order("date").limit(20);
  return (data ?? []) as Array<Record<string, unknown>>;
}

function findExactSubject(subjects: Array<{ id: string; code: string; name: string }>, input: string) {
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const q = normalize(input.trim());
  const byCode = subjects.find((s) => normalize(s.code) === q);
  if (byCode) return byCode;
  const byNameExact = subjects.find((s) => normalize(s.name) === q);
  if (byNameExact) return byNameExact;
  const matches = subjects.filter((s) => normalize(s.name).includes(q));
  return matches.length === 1 ? matches[0] : null;
}

async function buildCandidateHint(svc: ReturnType<typeof getServiceClient>, userId: string): Promise<string | undefined> {
  if (!userId) return undefined;
  try {
    const { data: notes } = await svc.from("notes").select("id, title, subject_id, note_date, subjects(code)").eq("author_id", userId).order("created_at", { ascending: false }).limit(8);
    const { data: events } = await svc.from("academic_events").select("id, title, date, subject_id, subjects(code)").eq("created_by", userId).order("date").limit(8);
    const parts: string[] = [];
    if (notes && notes.length > 0) {
      const lines = (notes as Array<Record<string, unknown>>).map((n) => {
        const code = (n.subjects as { code?: string } | null)?.code ?? "";
        return `nota id=${String(n.id)} título="${String(n.title).slice(0, 60)}" materia=${code} fecha=${String(n.note_date ?? "")}`;
      });
      parts.push(`Candidatos notas (usa solo estos IDs): ${lines.join(" | ")}`);
    }
    if (events && events.length > 0) {
      const lines = (events as Array<Record<string, unknown>>).map((e) => {
        const code = (e.subjects as { code?: string } | null)?.code ?? "";
        return `evento id=${String(e.id)} título="${String(e.title).slice(0, 60)}" materia=${code} fecha=${String(e.date ?? "")}`;
      });
      parts.push(`Candidatos eventos (usa solo estos IDs): ${lines.join(" | ")}`);
    }
    if (parts.length === 0) return undefined;
    return parts.join("\n");
  } catch {
    return undefined;
  }
}

export async function handleWhatsappMessage(waId: string, text: string, providerMessageId: string): Promise<EngineResult> {
  const svc = getServiceClient();
  const identity = await getIdentityByPhone(waId);
  const userId = identity?.user_id ?? null;
  const convo = await getConversation(waId);

  // 1. handle deterministic confirmation first (must not be reinterpreted by DeepSeek)
  const confirm = isConfirmText(text);
  if (convo?.pending_operation && convo.pending_expires_at) {
    if (isExpired(convo.pending_expires_at)) {
      await clearPending(waId);
      // fall through to normal handling
    } else if (confirm) {
      const op = convo.pending_operation as { kind: string; payload: Record<string, unknown> };
      // prevent replay: if same providerMessageId already used for this pending? we store pending_provider_message_id separately
      // For now, allow once, then clear
      if (confirm === "no") {
        await clearPending(waId);
        return { reply: "Listo, cancelé la operación. No cambié nada 🙂.", handled: true };
      }
      // yes -> execute
      // re-read targets before execution and verify ownership/state
      const result = await executePending(op, waId, userId, svc);
      await clearPending(waId);
      return { reply: result, handled: true };
    }
  }

  // 2. handle numeric choice for ambiguous selection
  const choice = isNumericChoice(text);
  if (choice && convo?.last_ambiguous) {
    const amb = convo.last_ambiguous as { kind: string; items: Array<Record<string, unknown>> };
    const idx = choice - 1;
    if (amb.items[idx]) {
      const selected = amb.items[idx];
      // clear ambiguous
      await upsertConversation(waId, { last_ambiguous: null });
      // if pending operation awaiting selection, inject selected id
      if (convo.pending_operation) {
        const pending = convo.pending_operation as { kind: string; payload: Record<string, unknown> };
        // map selection: if pending needs note_id/event_id/subject_code
        if (pending.kind === "edit_note" || pending.kind === "archive_note" || pending.kind === "unarchive_note" || pending.kind === "delete_note") {
          (pending.payload as Record<string, unknown>).note_id = String(selected.id ?? selected.note_id ?? "");
        } else if (pending.kind === "edit_event" || pending.kind === "cancel_event" || pending.kind === "toggle_complete") {
          (pending.payload as Record<string, unknown>).event_id = String(selected.id ?? selected.event_id ?? "");
        } else if (pending.kind === "read_notes" || pending.kind === "read_subject" || pending.kind === "read_schedule") {
          (pending.payload as Record<string, unknown>).subject_code = String(selected.code ?? "");
        } else if (pending.kind === "create_note") {
          // subject selection for create
          (pending.payload as Record<string, unknown>).subject_code = String(selected.code ?? selected.id ?? "");
        } else if (pending.kind === "create_event") {
          (pending.payload as Record<string, unknown>).subject_code = String(selected.code ?? selected.id ?? "");
        }
        // now re-validate and produce confirmation again? simpler: treat as confirmation step
        const summary = formatConfirmSummary(pending.kind, pending.payload);
        // refresh expiry
        await setPending(waId, pending, providerMessageId);
        return { reply: `${summary}`, handled: true };
      }
      // generic read selection: perform the requested read instead of raw JSON
      if (amb.kind === "read_subject") {
        const code = String(selected.code ?? "");
        const readReply = await handleRead({ kind: "read_subject", subject_code: code } as import("@/lib/whatsapp/validators").ValidatedDraft, svc, waId);
        return { reply: readReply, handled: true };
      }
      if (amb.kind === "read_notes") {
        const title = String(selected.title ?? "");
        const content = String(selected.content ?? "").slice(0, 120);
        const subjCode = String((selected.subjects as { code?: string } | null)?.code ?? "");
        const detail = `📝 Acá tenés el apunte:\nTítulo: ${title}\n${subjCode ? `Materia: ${subjCode}\n` : ""}${content ? `Contenido: ${content}\n` : ""}ID: ${String(selected.id).slice(0, 8)}`;
        return { reply: detail.slice(0, 1500), handled: true };
      }
      if (amb.kind === "create_note_subject") {
        return { reply: `✅ Elegiste ${String(selected.code ?? "")} — ${String(selected.name ?? "")}. Mandame de nuevo el pedido del apunte con esa materia.`, handled: true };
      }
      // fallback for other ambiguous kinds
      const title = String(selected.title ?? selected.name ?? selected.code ?? "");
      return { reply: `✅ Elegiste ${title} (${String(selected.id ?? "").slice(0, 8)}). Mandame de nuevo la consulta y te muestro el detalle.`, handled: true };
    }
  }

  // 3. if not linked, only allow linking instructions or code
  if (!userId) {
    // try code directly even without DeepSeek
    const trimmed = text.trim();
    if (/^\d{6}$/.test(trimmed) || trimmed.length >= 4) {
      const linkRes = await tryLink(waId, trimmed);
      if (linkRes) return linkRes;
    }
    // if message looks like linking attempt, try deepseek draft link
    const draft = (await callDeepseekDraft(text)) ?? detectLocalDraft(text, getWhatsappConfig().timezone);
    if (draft && draft.intent === "link") {
      const code = String((draft.payload as Record<string, unknown>)?.code ?? trimmed).trim();
      const linkRes2 = await tryLink(waId, code);
      if (linkRes2) return linkRes2;
    }
    return { reply: LINK_INSTRUCTIONS, handled: true };
  }

  // ensure conversation user_id set
  if (!convo || convo.user_id !== userId) {
    await upsertConversation(waId, { user_id: userId });
  }

  if (isFallbackText(text)) return { reply: FALLBACK_TEXT, handled: true };

  // 4. awaiting_relink confirmation for reassociation
  if (convo?.awaiting_relink && convo.relink_target_user_id) {
    if (isExpired(convo.relink_expires_at)) {
      await upsertConversation(waId, { awaiting_relink: false, relink_target_user_id: null, relink_challenge_id: null, relink_expires_at: null });
    } else if (confirm === "yes") {
      const target = convo.relink_target_user_id;
      const challengeId = (convo as unknown as { relink_challenge_id?: string | null }).relink_challenge_id ?? null;
      // consume exact challenge atomically BEFORE changing identity — fail before identity changes
      try {
        if (challengeId) {
          await markChallengeUsed(challengeId);
        } else {
          const ch = await findValidChallengeByUserId(target);
          if (!ch) {
            await upsertConversation(waId, { awaiting_relink: false, relink_target_user_id: null, relink_challenge_id: null, relink_expires_at: null });
            return { reply: "Ese código ya venció o se usó. Generá uno nuevo en Horarium y probamos otra vez 🙂.", handled: true };
          }
          await markChallengeUsed(ch.id);
        }
      } catch (e) {
        console.error("[whatsapp] relink mark used failed", e);
        return { reply: "No pude confirmar el cambio: el código venció o ya se usó. Generá uno nuevo y probamos otra vez.", handled: true };
      }
      await upsertIdentity(waId, target);
      await upsertConversation(waId, { user_id: target, awaiting_relink: false, relink_target_user_id: null, relink_challenge_id: null, relink_expires_at: null, pending_operation: null, pending_expires_at: null });
      return { reply: "✅ Listo, tu número quedó vinculado a esta cuenta.", handled: true };
    } else if (confirm === "no") {
      await upsertConversation(waId, { awaiting_relink: false, relink_target_user_id: null, relink_challenge_id: null, relink_expires_at: null });
      return { reply: "Dale, cancelé la reasociación. Tu número sigue con la cuenta anterior.", handled: true };
    } else if (confirm === null && text.trim().length > 1) {
      // not a confirmation, ignore and prompt
      return { reply: "Tu número ya está vinculado a otra cuenta. Respondé SI para pasarlo a esta cuenta o NO para dejarlo como está.", handled: true };
    }
  }

  // 5. normal flow: get draft via DeepSeek or local (with owned candidate hint for edits)
  let rawDraft: { intent: string; payload?: Record<string, unknown> } | null = null;
  const local = detectLocalDraft(text, getWhatsappConfig().timezone);
  if (local) rawDraft = local;
  else {
    const hint = await buildCandidateHint(svc, userId);
    rawDraft = await callDeepseekDraft(text, hint);
  }

  if (!rawDraft) {
    // try to answer reads directly without LLM
    if (text.toLowerCase().includes("materias")) {
      const subjects = await readSubjects(svc);
      const lines = subjects.map((s) => `• ${s.code} — ${s.name}`).join("\n");
      return { reply: `📚 Estas son tus materias:\n${lines}`, handled: true };
    }
    return { reply: FALLBACK_TEXT, handled: true };
  }

  const validated = validateDraft(rawDraft as unknown as import("@/lib/whatsapp/validators").BotDraft);
  if (!validated) {
    return { reply: FALLBACK_TEXT, handled: true };
  }

  // handle link inside authenticated flow
  if (validated.kind === "link") {
    const res = await tryLink(waId, validated.code);
    if (res) return res;
    return { reply: "Ese código no sirve o ya venció. Generá uno nuevo en Horarium (dura 10 minutos) y mandámelo por acá.", handled: true };
  }
  if (validated.kind === "help") {
    return { reply: HELP_TEXT, handled: true };
  }
  if (validated.kind === "unknown") {
    return { reply: FALLBACK_TEXT, handled: true };
  }

  // read operations: execute directly, no confirmation
  if (validated.kind.startsWith("read_")) {
    const readReply = await handleRead(validated, svc, waId);
    return { reply: readReply, handled: true };
  }

  // mutations: require confirmation
  // Check allowlist: never allow delete_event (not in validated but double-check)
  if ((validated as { kind: string }).kind === "delete_event") {
    return { reply: "No puedo borrar eventos de forma permanente. Si querés, puedo cancelarlo y queda guardado como cancelado.", handled: true };
  }

  // For notes mutations, verify at least draft is valid; ambiguous handling may need selection
  // If draft references note_id/event_id that is ambiguous, we need to persist choices
  const pendingPayload = draftToPayload(validated);
  const pendingKind = validated.kind;

  // For operations without explicit id but needing selection (e.g., edit without id?), validated already requires id, so ambiguous only for subject_code? We'll handle subject ambiguity via subjects list
  // Example: create_note subject_code must match exactly; otherwise show candidates
  if (pendingKind === "create_note" || pendingKind === "create_event") {
    const subjects = await readSubjects(svc);
    const subjectCode = String(pendingPayload.subject_code ?? "");
    const match = findExactSubject(subjects, subjectCode);
    if (subjectCode && !match) {
      const bounded = subjects.slice(0, 10);
      const choices = ambiguousChoices(bounded, (s) => `${s.code} - ${s.name}`);
      await upsertConversation(waId, { last_ambiguous: { kind: `${pendingKind}_subject`, items: bounded } as unknown as Record<string, unknown> });
      await setPending(waId, { kind: pendingKind, payload: pendingPayload }, providerMessageId);
      return { reply: `No encontré la materia “${subjectCode}”. ${choices}`, handled: true };
    }
    // keep exact code as stored; mapping to id happens on execute
    if (match) pendingPayload.subject_code = match.code;
  }

  // for toggle_complete, enrich payload with actual event mode and completion state before confirmation
  let payloadForConfirm: Record<string, unknown> = pendingPayload;
  if (pendingKind === "toggle_complete") {
    const eventId = String(pendingPayload.event_id);
    const { data: evt } = await svc.from("academic_events").select("id, event_type, completed_by").eq("id", eventId).maybeSingle();
    if (!evt) return { reply: "No encontré ese evento o no tenés permiso para verlo.", handled: true };
    const et = (evt as { event_type: string }).event_type ?? "individual";
    payloadForConfirm = { ...pendingPayload, event_type: et };
    // check ownership for message? ownership is checked again on execute; here just enrich
    if (et === "individual") {
      const { data: comp } = await svc.from("academic_event_completions").select("event_id").eq("event_id", eventId).eq("user_id", userId).maybeSingle();
      (payloadForConfirm as Record<string, unknown>).currently_completed = Boolean(comp);
    } else {
      (payloadForConfirm as Record<string, unknown>).currently_completed = Boolean((evt as { completed_by: string | null }).completed_by);
    }
  }

  // store pending (use enriched payload for toggle_complete so confirmation warns correctly)
  const pendingToStore = pendingKind === "toggle_complete" ? payloadForConfirm : pendingPayload;
  await setPending(waId, { kind: pendingKind, payload: pendingToStore }, providerMessageId);
  const summary = formatConfirmSummary(pendingKind, pendingToStore);
  return { reply: summary, handled: true };
}

async function tryLink(waId: string, code: string): Promise<EngineResult | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;
  const { hashLinkCode } = await import("@/lib/whatsapp/hmac");
  const h = hashLinkCode(trimmed);
  const challenge = await findValidChallengeByHash(h);
  if (!challenge) return null;
  const existing = await getIdentityByPhone(waId);
  if (existing && existing.user_id !== challenge.user_id) {
    // require deterministic WhatsApp confirmation before reassociation — store exact challenge id
    await upsertConversation(waId, {
      awaiting_relink: true,
      relink_target_user_id: challenge.user_id,
      relink_challenge_id: challenge.id,
      relink_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
    return { reply: `Este número ya está vinculado a otra cuenta. ¿Querés pasarlo a tu cuenta actual?\nRespondé SI para confirmar o NO para cancelar. Tenés 10 minutos.`, handled: true };
  }
  // consume challenge BEFORE changing identity so failure cannot leave reusable challenge + changed identity
  await markChallengeUsed(challenge.id);
  await upsertIdentity(waId, challenge.user_id);
  await upsertConversation(waId, { user_id: challenge.user_id, awaiting_relink: false, relink_target_user_id: null, relink_challenge_id: null, relink_expires_at: null });
  return { reply: "✅ ¡Listo! Tu número ya está vinculado a Horarium. Escribí “ayuda” y vemos qué necesitás.", handled: true };
}

function draftToPayload(v: import("@/lib/whatsapp/validators").ValidatedDraft): Record<string, unknown> {
  const { kind: _kind, ...rest } = v as unknown as Record<string, unknown>;
  void _kind;
  return rest as Record<string, unknown>;
}

type ScheduleRow = Record<string, unknown>;

function relation<T extends object>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T | undefined) ?? null;
  return (value as T | null) ?? null;
}

function scheduleLine(row: ScheduleRow, includeSubject = false): string {
  const subject = relation<{ code?: string }>(row.subjects);
  const professor = relation<{ display_name?: string }>(row.professors)?.display_name;
  const room = relation<{ name?: string }>(row.rooms)?.name;
  const day = ({ Monday: "Lunes", Tuesday: "Martes", Wednesday: "Miércoles", Thursday: "Jueves", Friday: "Viernes" } as Record<string, string>)[String(row.day)] ?? String(row.day);
  const prefix = includeSubject && subject?.code ? `${subject.code} · ` : "";
  return `• ${prefix}${day} ${String(row.start_time).slice(0, 5)}–${String(row.end_time).slice(0, 5)} · ${String(row.section)} · 👨‍🏫 ${professor || "docente sin asignar"} · 🏫 ${room || "aula sin asignar"}`;
}

async function handleRead(validated: import("@/lib/whatsapp/validators").ValidatedDraft, svc: ReturnType<typeof getServiceClient>, waId: string): Promise<string> {
  if (validated.kind === "read_subjects") {
    const subjects = await readSubjects(svc);
    if (subjects.length === 0) return "Todavía no tengo materias cargadas 📚.";
    const lines = subjects.map((s) => `• ${s.code} — ${s.name}`).join("\n");
    return `📚 Estas son tus materias:\n${lines}`;
  }
  if (validated.kind === "read_subject") {
    const subjects = await readSubjects(svc);
    const found = findExactSubject(subjects, validated.subject_code);
    if (!found) {
      const bounded = subjects.slice(0, 10);
      const choices = ambiguousChoices(bounded, (s) => `${s.code} — ${s.name}`);
      await upsertConversation(waId, { last_ambiguous: { kind: "read_subject", items: bounded } as unknown as Record<string, unknown> });
      return `No encontré la materia “${validated.subject_code}”. ${choices}`;
    }
    const schedules = await readSchedulesForSubject(svc, found.id);
    const notes = await readNotes(svc, "", found.id);
    const events = await readEvents(svc);
    const relatedEvents = events.filter((e) => String(e.subject_id ?? "") === found.id).slice(0, 5);
    let out = `📚 ${found.code} — ${found.name}\n`;
    if (schedules.length > 0) {
      out += `\n🕒 Horarios:\n${(schedules as ScheduleRow[]).map((r) => scheduleLine(r)).join("\n")}`;
    } else out += "\n🕒 Todavía no hay horarios cargados para esta materia.";
    out += `\n\n📝 Apuntes relacionados (${notes.length}):\n${notes.slice(0, 5).map((n) => `• ${String(n.title)} (${String(n.status)})`).join("\n") || "Todavía no hay apuntes."}`;
    out += `\n\n📅 Eventos relacionados (${relatedEvents.length}):\n${relatedEvents.map((e) => `• ${String(e.title)} · ${String(e.date)} · ${String(e.status)}`).join("\n") || "Todavía no hay eventos."}`;
    return out.slice(0, 3000);
  }
  if (validated.kind === "read_schedule") {
    const subjects = await readSubjects(svc);
    if (validated.all_subjects) {
      const rows = await readSchedulesForSubject(svc, null) as ScheduleRow[];
      const sections = subjects.map((subject) => {
        const subjectRows = rows.filter((row) => String(row.subject_id) === subject.id);
        return `*${subject.code} — ${subject.name}*\n${subjectRows.length > 0 ? subjectRows.map((row) => scheduleLine(row)).join("\n") : "• Todavía no hay horarios cargados para esta materia."}`;
      });
      return sections.length > 0 ? `🕒 Horarios de cada materia:\n\n${sections.join("\n\n")}` : "Todavía no tengo materias cargadas para mostrar horarios 📚.";
    }
    let subjectId: string | null = null;
    if (validated.subject_code) {
      const found = findExactSubject(subjects, validated.subject_code);
      if (!found) return `No encontré la materia “${validated.subject_code}”. Probá con el código, por ejemplo RED.`;
      subjectId = found.id;
    }
    const rows = await readSchedulesForSubject(svc, subjectId);
    if (rows.length === 0) return validated.subject_code ? `Para ${validated.subject_code} todavía no hay horarios cargados 🕒.` : "Todavía no hay horarios cargados para mostrar 🕒.";
    const lines = (rows as ScheduleRow[]).slice(0, 100).map((r) => scheduleLine(r, !validated.subject_code)).join("\n");
    return `🕒 Horarios${validated.subject_code ? ` de ${validated.subject_code}` : ""}:\n${lines}`;
  }
  if (validated.kind === "read_notes") {
    let subjectId: string | null = null;
    if (validated.subject_code) {
      const subjects = await readSubjects(svc);
      const found = findExactSubject(subjects, validated.subject_code);
      if (found) subjectId = found.id;
    }
    const notes = await readNotes(svc, "", subjectId, validated.query);
    if (notes.length === 0) return "No encontré apuntes con ese criterio 📝.";
    if (notes.length > 5 && !validated.query) {
      // ambiguous: show choices
      const choices = ambiguousChoices(notes.slice(0,10), (n) => `${String(n.title)} — ${String((n.subjects as {code?:string}|null)?.code ?? "")} (${String(n.status)})`);
      await upsertConversation(waId, { last_ambiguous: { kind: "read_notes", items: notes.slice(0,10) } as unknown as Record<string, unknown> });
      return `📝 Encontré ${notes.length} apuntes. ${choices}`;
    }
    const lines = notes.slice(0,10).map((n) => `• ${String(n.title)} | ${String(n.content).slice(0,80)} | ${String(n.note_date ?? "")} | tags: ${Array.isArray(n.tags) ? (n.tags as string[]).join(",") : ""}`).join("\n");
    return `📝 Tus apuntes:\n${lines}`;
  }
  if (validated.kind === "read_events") {
    const events = await readEvents(svc);
    let filtered = events.filter((e) => String(e.status) !== "cancelled");
    if (validated.filter === "__week__") {
      const timeZone = getWhatsappConfig().timezone;
      filtered = filtered.filter((event) => isDateInCurrentWeek(String(event.date), new Date(), timeZone));
    } else if (validated.filter) {
      const f = validated.filter.toLowerCase();
      filtered = filtered.filter((e) => String(e.title).toLowerCase().includes(f) || String(e.type).toLowerCase().includes(f));
    }
    if (filtered.length === 0) return validated.filter === "__week__" ? "Esta semana no tenés eventos agendados 📅." : "No encontré eventos que coincidan 📅.";
    const lines = filtered.slice(0, 10).map((e) => `• ${String(e.title)} · ${String(e.date)}${e.time ? ` · ${String(e.time)}` : ""} · ${String((relation<{ code?: string }>(e.subjects))?.code ?? "")} · ${String(e.status)}`).join("\n");
    return `📅 Tus eventos${validated.filter === "__week__" ? " de esta semana" : ""}:\n${lines}`;
  }
  return HELP_TEXT;
}

async function executePending(op: { kind: string; payload: Record<string, unknown> }, waId: string, userId: string | null, svc: ReturnType<typeof getServiceClient>): Promise<string> {
  if (!userId) return "Primero necesitás vincular tu número 🙂.\n\n" + LINK_INSTRUCTIONS;
  const kind = op.kind;
  const p = op.payload;

  // notes
  if (kind === "create_note") {
    const subjects = await readSubjects(svc);
    const subj = subjects.find((s) => s.code.toLowerCase() === String(p.subject_code).toLowerCase());
    if (!subj) return "No encontré esa materia, así que no guardé el apunte.";
    const { data, error } = await svc.from("notes").insert({
      subject_id: subj.id,
      author_id: userId,
      title: String(p.title),
      content: String(p.content),
      blocks: [{ id: "initial", type: "paragraph", text: String(p.content) }],
      note_date: p.note_date ? String(p.note_date) : null,
      tags: Array.isArray(p.tags) ? p.tags : [],
      status: "active",
    }).select("id").maybeSingle();
    if (error) return "No pude guardar el apunte. Probá de nuevo en un ratito.";
    return `✅ Apunte guardado${(data as { id: string } | null)?.id ? ` (id ${String((data as { id: string }).id).slice(0, 8)})` : ""}.`;
  }
  if (kind === "edit_note") {
    const noteId = String(p.note_id);
    const { data: existing, error: fetchErr } = await svc.from("notes").select("id, author_id, title, content, note_date, tags, attachments").eq("id", noteId).maybeSingle();
    if (fetchErr || !existing) return "No encontré ese apunte o no tenés permiso para editarlo.";
    if ((existing as { author_id: string | null }).author_id !== userId) return "Solo podés editar tus propios apuntes 🙂.";
    const update: Record<string, unknown> = {};
    if (p.title !== undefined) update.title = String(p.title);
    if (p.content !== undefined) {
      update.content = String(p.content);
      update.blocks = [{ id: "initial", type: "paragraph", text: String(p.content) }];
    }
    if (p.note_date !== undefined) update.note_date = p.note_date ? String(p.note_date) : null;
    if (p.tags !== undefined) update.tags = p.tags;
    // preserve attachments: do not touch note_attachments
    const { error } = await svc.from("notes").update(update).eq("id", noteId).eq("author_id", userId);
    if (error) return "No pude actualizar el apunte. Probá de nuevo en un ratito.";
    return "✅ Apunte actualizado.";
  }
  if (kind === "archive_note") {
    const noteId = String(p.note_id);
    const { data: existing } = await svc.from("notes").select("id, author_id, status").eq("id", noteId).maybeSingle();
    if (!existing) return "No encontré ese apunte.";
    if ((existing as { author_id: string | null }).author_id !== userId) return "Solo podés archivar tus propios apuntes 🙂.";
    if ((existing as { status: string }).status === "archived") return "Ese apunte ya está archivado.";
    const { error } = await svc.from("notes").update({ status: "archived" }).eq("id", noteId).eq("author_id", userId);
    if (error) return "No pude archivar el apunte. Probá de nuevo en un ratito.";
    return "✅ Apunte archivado.";
  }
  if (kind === "unarchive_note") {
    const noteId = String(p.note_id);
    const { data: existing } = await svc.from("notes").select("id, author_id, status").eq("id", noteId).maybeSingle();
    if (!existing) return "No encontré ese apunte.";
    if ((existing as { author_id: string | null }).author_id !== userId) return "Solo podés volver a activar tus propios apuntes 🙂.";
    if ((existing as { status: string }).status === "active") return "Ese apunte ya está activo.";
    const { error } = await svc.from("notes").update({ status: "active" }).eq("id", noteId).eq("author_id", userId);
    if (error) return "No pude volver a activar el apunte. Probá de nuevo en un ratito.";
    return "✅ Apunte activado.";
  }
  if (kind === "delete_note") {
    const noteId = String(p.note_id);
    const { data: existing } = await svc.from("notes").select("id, author_id").eq("id", noteId).maybeSingle();
    if (!existing) return "No encontré ese apunte.";
    if ((existing as { author_id: string | null }).author_id !== userId) return "Solo podés eliminar tus propios apuntes 🙂.";
    // follow existing cleanup: delete note_attachments via cascade, also clean storage? For now delete note row
    const { error } = await svc.from("notes").delete().eq("id", noteId).eq("author_id", userId);
    if (error) return "No pude eliminar el apunte. Probá de nuevo en un ratito.";
    // also delete attachments storage? best-effort: delete from note_attachments already cascaded; storage objects remain but not broadened
    return "✅ Apunte eliminado definitivamente.";
  }

  // events
  if (kind === "create_event") {
    const title = String(p.title);
    const type = String(p.type);
    if (!(EVENT_TYPES as readonly string[]).includes(type)) return "No reconocí el tipo de evento.";
    const date = String(p.date);
    const time = p.time ? String(p.time) : null;
    let subject_id: string | null = null;
    if (p.subject_code) {
      const subjects = await readSubjects(svc);
      const subj = subjects.find((s) => s.code.toLowerCase() === String(p.subject_code).toLowerCase());
      if (!subj) return "No encontré esa materia para el evento.";
      subject_id = subj.id;
    }
    const event_type = (p.event_type as string) ?? "individual";
    const { error } = await svc.from("academic_events").insert({
      title,
      type,
      date,
      time,
      subject_id,
      description: p.description ? String(p.description) : null,
      status: "pending",
      created_by: userId,
      event_type,
    });
    if (error) return "No pude agendar el evento. Probá de nuevo en un ratito.";
    return "✅ Evento agendado.";
  }
  if (kind === "edit_event") {
    const eventId = String(p.event_id);
    const { data: existing } = await svc.from("academic_events").select("id, created_by, status").eq("id", eventId).maybeSingle();
    if (!existing) return "No encontré ese evento.";
    if ((existing as { created_by: string | null }).created_by !== userId) return "Solo podés editar tus propios eventos 🙂.";
    if ((existing as { status: string }).status === "cancelled" && p.status !== "pending") {
      // allow re-activate? but keep simple
    }
    const update: Record<string, unknown> = {};
    if (p.title !== undefined) update.title = String(p.title);
    if (p.type !== undefined) update.type = String(p.type);
    if (p.date !== undefined) update.date = String(p.date);
    if (p.time !== undefined) update.time = p.time ? String(p.time) : null;
    if (p.subject_code !== undefined) {
      if (!p.subject_code) update.subject_id = null;
      else {
        const subjects = await readSubjects(svc);
        const subj = subjects.find((s) => s.code.toLowerCase() === String(p.subject_code).toLowerCase());
        if (!subj) return "No encontré esa materia.";
        update.subject_id = subj.id;
      }
    }
    if (p.description !== undefined) update.description = p.description ? String(p.description) : null;
    if (p.status !== undefined) {
      const s = String(p.status);
      if (s === "cancelled" || s === "pending") update.status = s;
      else return "Ese estado no está permitido. Usá cancelar, pendiente o “marcar como completado”.";
    }
    if (p.event_type !== undefined) update.event_type = String(p.event_type);
    const { error } = await svc.from("academic_events").update(update).eq("id", eventId).eq("created_by", userId);
    if (error) return "No pude actualizar el evento. Probá de nuevo en un ratito.";
    return "✅ Evento actualizado.";
  }
  if (kind === "cancel_event") {
    const eventId = String(p.event_id);
    const { data: existing } = await svc.from("academic_events").select("id, created_by, status").eq("id", eventId).maybeSingle();
    if (!existing) return "No encontré ese evento.";
    if ((existing as { created_by: string | null }).created_by !== userId) return "Solo podés cancelar tus propios eventos 🙂.";
    if ((existing as { status: string }).status === "cancelled") return "Ese evento ya está cancelado.";
    const { error } = await svc.from("academic_events").update({ status: "cancelled" }).eq("id", eventId).eq("created_by", userId);
    if (error) return "No pude cancelar el evento. Probá de nuevo en un ratito.";
    return "✅ Evento cancelado. Queda guardado como cancelado y podés revertirlo después.";
  }
  if (kind === "toggle_complete") {
    const eventId = String(p.event_id);
    const { data: existing } = await svc.from("academic_events").select("id, event_type, completed_by").eq("id", eventId).maybeSingle();
    if (!existing) return "No encontré ese evento.";
    const et = (existing as { event_type: string }).event_type ?? "individual";
    if (et === "grupal") {
      const current = (existing as { completed_by: string | null }).completed_by;
      if (current) {
        const { error } = await svc.from("academic_events").update({ completed_by: null, completed_at: null }).eq("id", eventId);
        if (error) return "No pude quitar el completado del evento grupal.";
        return "✅ Evento grupal desmarcado como completado. Esto afectó a todos los participantes.";
      } else {
        const { error } = await svc.from("academic_events").update({ completed_by: userId, completed_at: new Date().toISOString() }).eq("id", eventId);
        if (error) return "No pude marcar el evento grupal como completado.";
        return "✅ Evento grupal marcado como completado. Esto afecta a todos los participantes.";
      }
    } else {
      // individual: use completions table
      const { data: comp } = await svc.from("academic_event_completions").select("event_id, user_id").eq("event_id", eventId).eq("user_id", userId).maybeSingle();
      if (comp) {
        const { error } = await svc.from("academic_event_completions").delete().eq("event_id", eventId).eq("user_id", userId);
        if (error) return "No pude quitar tu tilde de completado.";
        return "✅ Saqué tu tilde de completado.";
      } else {
        const { error } = await svc.from("academic_event_completions").insert({ event_id: eventId, user_id: userId });
        if (error && (error as { code?: string }).code !== "23505") return "No pude marcar el evento como completado.";
        return "✅ Evento marcado como completado (solo para vos).";
      }
    }
  }

  return "Todavía no puedo hacer esa acción.";
}
