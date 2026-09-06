import { describe, expect, it } from "vitest";
import { isDateInCurrentWeek, resolveNaturalDate } from "@/lib/whatsapp/dates";
import { detectLocalDraft } from "@/lib/whatsapp/intent";
import { FALLBACK_TEXT, formatConfirmSummary } from "@/lib/whatsapp/format";

const TIME_ZONE = "America/Argentina/Tucuman";

describe("WhatsApp deterministic intent fallback", () => {
  it("resolves próximo martes strictly after today in Tucumán", () => {
    const now = new Date("2026-09-06T15:00:00.000Z");
    expect(resolveNaturalDate("el próximo martes", now, TIME_ZONE)).toBe("2026-09-08");
  });

  it("routes natural schedule and professor questions", () => {
    expect(detectLocalDraft("en qué horarios se dicta cada materia", TIME_ZONE)).toEqual({
      intent: "read_schedule",
      payload: { all_subjects: true },
    });
    expect(detectLocalDraft("quién es el profe de redes", TIME_ZONE)).toEqual({
      intent: "read_schedule",
      payload: { subject_code: "redes" },
    });
  });

  it("creates a deterministic event draft from the reported Spanish phrasing", () => {
    const draft = detectLocalDraft("tengo un parcial de redes el próximo martes, apuntalo como evento", TIME_ZONE);
    expect(draft).toMatchObject({ intent: "create_event" });
    expect(draft?.payload).toMatchObject({ type: "parcial", subject_code: "redes", date: "2026-09-08" });
  });

  it("supports this-week event reads and friendly fallback copy", () => {
    expect(detectLocalDraft("qué tengo esta semana", TIME_ZONE)).toEqual({ intent: "read_events", payload: { filter: "__week__" } });
    expect(FALLBACK_TEXT).toContain("Te leo");
    expect(formatConfirmSummary("create_event", { title: "Parcial de RED", type: "parcial", date: "2026-09-08", subject_code: "RED" })).toContain("SI");
    expect(formatConfirmSummary("create_event", { title: "Parcial de RED", type: "parcial", date: "2026-09-08", subject_code: "RED" })).toContain("NO");
    expect(formatConfirmSummary("create_event", { title: "Parcial de RED", type: "parcial", date: "2026-09-08", subject_code: "RED" })).toContain("10 minutos");
    expect(isDateInCurrentWeek("2026-09-08", new Date("2026-09-07T15:00:00.000Z"), TIME_ZONE)).toBe(true);
  });
});
