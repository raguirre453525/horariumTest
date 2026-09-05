import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Política de privacidad — Horarium",
  description:
    "Cómo Horarium trata los datos de cuenta, contenido académico e integraciones opcionales (WhatsApp, Drive, DeepSeek).",
};

const updated = "4 de septiembre de 2026";

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-12">
        <header className="mb-8">
          <Link href="/" className="text-sm font-medium text-[var(--accent)] hover:underline">
            ← Volver a Horarium
          </Link>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-[var(--ink)]">Política de privacidad</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">Actualizada el {updated} · Horarium — horario universitario semanal compartido.</p>
          <nav className="mt-4 flex flex-wrap gap-3 text-sm">
            <Link href="/terms" className="underline decoration-[var(--line)] underline-offset-4 hover:text-[var(--ink)]">
              Términos
            </Link>
            <Link href="/data-deletion" className="underline decoration-[var(--line)] underline-offset-4 hover:text-[var(--ink)]">
              Eliminación de datos
            </Link>
          </nav>
        </header>

        <article className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 sm:p-8 leading-relaxed text-[15px]">
          <p className="text-[var(--ink)]">
            Horarium es una aplicación de horario universitario semanal, notas colaborativas y eventos académicos. Esta
            política describe qué datos trata, con qué finalidad y con qué servicios de terceros opera, basándose en el
            comportamiento real de la aplicación. No promete plazos de conservación, entidades legales, certificaciones ni
            automatismos que no existen en el código.
          </p>

          <h2 className="mt-8 text-lg font-semibold text-[var(--ink)]">1. Responsable</h2>
          <p>
            El responsable es quien opera la instancia desplegada de Horarium. La aplicación no declara una razón social
            propia: el despliegue funciona sobre Supabase (datos y autenticación) y Vercel (hosting). Si despliega su
            propia instancia, usted es el responsable frente a sus usuarios.
          </p>

          <h2 className="mt-8 text-lg font-semibold text-[var(--ink)]">2. Qué datos tratamos</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              <strong className="text-[var(--ink)]">Cuenta y perfil:</strong> email y credenciales gestionadas por Supabase Auth; perfil en{" "}
              <code className="rounded bg-[var(--soft)] px-1 py-0.5 text-xs">public.profiles</code> con alias (display_name),
              avatar (avatar_url) y rol (user/admin). El registro dispara{" "}
              <code className="rounded bg-[var(--soft)] px-1 py-0.5 text-xs">handle_new_user()</code>.
            </li>
            <li>
              <strong className="text-[var(--ink)]">Contenido académico:</strong> materias, horarios, profesores y aulas (catálogos);
              notas (<code className="rounded bg-[var(--soft)] px-1 py-0.5 text-xs">notes</code>: título, contenido hasta 2000 caracteres,
              bloques, fecha, etiquetas, estado active/archived, session_id), comentarios de notas, eventos académicos
              (título, tipo parcial/entrega/recuperatorio/exposición/otro, fecha, hora, materia, descripción, estado,
              event_type individual/grupal, completados) y notificaciones. En modo sin Supabase el contenido queda en el
              demo local o en localStorage del navegador.
            </li>
            <li>
              <strong className="text-[var(--ink)]">Archivos:</strong> adjuntos de notas (hasta 10 MB en Supabase Storage bucket{" "}
              <code className="rounded bg-[var(--soft)] px-1 py-0.5 text-xs">note-attachments</code>, privado; validación local de hasta 2 MB) y
              avatares (bucket <code className="rounded bg-[var(--soft)] px-1 py-0.5 text-xs">avatars</code>, lectura pública). Documentos
              vivos de Google Drive solo si{" "}
              <code className="rounded bg-[var(--soft)] px-1 py-0.5 text-xs">GOOGLE_DRIVE_ROOT_ID</code> y credenciales de servicio/OAuth están
              configurados.
            </li>
            <li>
              <strong className="text-[var(--ink)]">Uso opcional de WhatsApp:</strong> solo si vincula su número. Se guardan identidad (
              <code className="rounded bg-[var(--soft)] px-1 py-0.5 text-xs">whatsapp_identities</code>: phone → user_id), desafíos de vinculación
              hasheados de 6 dígitos válidos 10 minutos (
              <code className="rounded bg-[var(--soft)] px-1 py-0.5 text-xs">whatsapp_link_challenges</code>), mensajes inbound/outbound (
              <code className="rounded bg-[var(--soft)] px-1 py-0.5 text-xs">whatsapp_messages</code> con provider_message_id único) y estado de
              conversación (<code className="rounded bg-[var(--soft)] px-1 py-0.5 text-xs">whatsapp_conversations</code>).
            </li>
            <li>
              <strong className="text-[var(--ink)]">Datos técnicos mínimos:</strong> cabeceras de verificación del webhook de Meta (firma
              HMAC SHA-256, phone_number_id) y logs de aplicación para depurar entregas. Sin seguimiento publicitario.
            </li>
          </ul>

          <h2 className="mt-8 text-lg font-semibold text-[var(--ink)]">3. Finalidad y base</h2>
          <p>
            Mostrar el horario compartido, permitir crear y colaborar en notas y eventos, y —si lo habilita— atender
            consultas y operaciones vía WhatsApp con confirmación explícita (sí/no). La base es la ejecución del servicio
            solicitado y su consentimiento al crear la cuenta y vincular canales opcionales.
          </p>

          <h2 className="mt-8 text-lg font-semibold text-[var(--ink)]">4. Encargados y transferencias</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              <strong className="text-[var(--ink)]">Supabase</strong> — base de datos Postgres, Auth y Storage. Rige su política y DPA.
            </li>
            <li>
              <strong className="text-[var(--ink)]">Vercel</strong> — hosting y edge del Next.js. Incluye el cron{" "}
              <code className="rounded bg-[var(--soft)] px-1 py-0.5 text-xs">/api/cron/archive-live-notes</code> protegido con{" "}
              <code className="rounded bg-[var(--soft)] px-1 py-0.5 text-xs">CRON_SECRET</code>.
            </li>
            <li>
              <strong className="text-[var(--ink)]">Meta / WhatsApp Cloud API</strong> — solo mensajes que envías al número configurado
              (graph.facebook.com/{`{graphVersion}`}/{`{phoneNumberId}`}). Requiere verificación de firma{" "}
              <code className="rounded bg-[var(--soft)] px-1 py-0.5 text-xs">WHATSAPP_APP_SECRET</code> y token de verificación.
            </li>
            <li>
              <strong className="text-[var(--ink)]">DeepSeek API</strong> — solo para interpretar el texto de WhatsApp y generar un borrador
              estructurado (modelo {`{DEEPSEEK_MODEL}`}). No se envían IDs inventados; si el modelo está caído, se usa un
              heurístico local acotado.
            </li>
            <li>
              <strong className="text-[var(--ink)]">Google Drive API</strong> — solo si configura Service Account u OAuth; crea documentos
              vivos por materia y gestiona permisos de acceso.
            </li>
          </ul>
          <p className="mt-3">No se venden datos ni se comparten con terceros fuera de estos encargados necesarios.</p>

          <h2 className="mt-8 text-lg font-semibold text-[var(--ink)]">5. Conservación</h2>
          <p>
             Los datos permanecen mientras su cuenta esté activa y el contenido no sea archivado o eliminado por usted o por
            un administrador. No se declaran plazos automáticos de borrado; el cron solo archiva notas vivas según{" "}
            <code className="rounded bg-[var(--soft)] px-1 py-0.5 text-xs">LIVE_NOTE_DURATION_HOURS</code> cuando está habilitado.
          </p>

          <h2 id="eliminacion" className="mt-8 text-lg font-semibold text-[var(--ink)]">
            6. Tus derechos y eliminación de datos
          </h2>
          <p>
            Puede acceder, corregir, archivar y eliminar su propio contenido (notas, eventos, comentarios, adjuntos, perfil
            y avatar) directamente en la aplicación. Para la eliminación completa de su cuenta y de los datos asociados
            a WhatsApp, solicite el borrado al administrador de la instancia. El detalle del proceso está en la página
            dedicada:
          </p>
          <p className="mt-3">
            <Link href="/data-deletion" className="font-medium text-[var(--accent)] hover:underline">
              Instrucciones de eliminación de datos →
            </Link>
          </p>
          <p className="mt-3 text-sm text-[var(--muted)]">
            Nota: la aplicación no expone un correo de soporte propio. El canal válido es el administrador de la
            instancia (panel Administración) o el contacto que el operador del despliegue haya publicado. No inventes
            direcciones en su solicitud; utilice el mecanismo disponible en su instalación.
          </p>

          <h2 className="mt-8 text-lg font-semibold text-[var(--ink)]">7. Seguridad</h2>
          <p>
            Acceso a Postgres mediante Row Level Security (políticas públicas para lectura de horario/eventos y
            autenticadas para notas/comentarios/adjuntos), bucket privado para adjuntos y uso de{" "}
            <code className="rounded bg-[var(--soft)] px-1 py-0.5 text-xs">SUPABASE_SERVICE_ROLE_KEY</code> solo en servidor (nunca
            en <code className="rounded bg-[var(--soft)] px-1 py-0.5 text-xs">NEXT_PUBLIC_*</code>). Comunicaciones por HTTPS y verificación
            HMAC del webhook. No se afirman certificaciones ISO/SOC u otras no verificadas.
          </p>

          <h2 className="mt-8 text-lg font-semibold text-[var(--ink)]">8. Cambios</h2>
          <p>
            Cualquier cambio relevante se reflejará en esta página con nueva fecha de actualización. El uso continuado
            después de la actualización implica aceptación.
          </p>

          <hr className="my-8 border-[var(--line)]" />
          <p className="text-sm text-[var(--muted)]">
            Esta política cubre los datos que Horarium efectivamente trata según el repositorio auditado. Para preguntas
             sobre su instancia concreta, contacte al administrador que opera ese despliegue. ·{" "}
            <Link href="/terms" className="underline underline-offset-4">
              Términos
            </Link>{" "}
            ·{" "}
            <Link href="/data-deletion" className="underline underline-offset-4">
              Eliminación
            </Link>
          </p>
        </article>
      </div>
    </main>
  );
}
