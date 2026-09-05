import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Eliminación de datos — Horarium",
  description: "Cómo solicitar la eliminación de una cuenta y sus datos asociados en Horarium (proceso manual por administrador).",
};

const updated = "4 de septiembre de 2026";

export default function DataDeletionPage() {
  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-12">
        <header className="mb-8">
          <Link href="/" className="text-sm font-medium text-[var(--accent)] hover:underline">
            ← Volver a Horarium
          </Link>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-[var(--ink)]">Eliminación de datos</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">Actualizada el {updated}.</p>
          <nav className="mt-4 flex flex-wrap gap-3 text-sm">
            <Link href="/privacy" className="underline decoration-[var(--line)] underline-offset-4 hover:text-[var(--ink)]">
              Privacidad
            </Link>
            <Link href="/terms" className="underline decoration-[var(--line)] underline-offset-4 hover:text-[var(--ink)]">
              Términos
            </Link>
          </nav>
        </header>

        <article className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 sm:p-8 leading-relaxed text-[15px]">
          <p className="text-[var(--ink)]">
             Esta página explica cómo pedir la eliminación de una cuenta y sus datos personales en Horarium. El proceso es
             manual y lo ejecuta el administrador de la instancia donde se utiliza el servicio. No se inventan direcciones de
            correo ni portales automáticos: utilice el canal real que su instalación ofrece.
          </p>

          <h2 className="mt-8 text-lg font-semibold text-[var(--ink)]">1. Qué se elimina</h2>
          <p>Cuando el administrador procesa su solicitud, debe eliminar o desasociar:</p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              Cuenta en Supabase Auth y fila en <code className="rounded bg-[var(--soft)] px-1 py-0.5 text-xs">profiles</code> (alias, avatar, rol).
            </li>
            <li>
              Identidad de WhatsApp (<code className="rounded bg-[var(--soft)] px-1 py-0.5 text-xs">whatsapp_identities</code>), desafíos de vinculación
              (<code className="rounded bg-[var(--soft)] px-1 py-0.5 text-xs">whatsapp_link_challenges</code>), mensajes (
              <code className="rounded bg-[var(--soft)] px-1 py-0.5 text-xs">whatsapp_messages</code>) y estado de conversación (
              <code className="rounded bg-[var(--soft)] px-1 py-0.5 text-xs">whatsapp_conversations</code>) asociados a su teléfono.
            </li>
            <li>
               Contenido creado por el usuario: notas, comentarios, adjuntos en Storage (
              <code className="rounded bg-[var(--soft)] px-1 py-0.5 text-xs">note-attachments</code> y{" "}
              <code className="rounded bg-[var(--soft)] px-1 py-0.5 text-xs">avatars</code>), eventos académicos creados, completados de eventos
              y notificaciones. Nota técnica: por esquema, <code className="rounded bg-[var(--soft)] px-1 py-0.5 text-xs">notes.author_id</code> y
               similares usan <em>on delete set null</em>; el administrador debe borrar explícitamente esas filas si solicita el
              borrado completo, no basta con borrar solo el usuario de Auth.
            </li>
            <li>Documentos vivos en Google Drive creados por la integración, si corresponde (borrado en Drive).</li>
          </ul>
          <p className="mt-3 text-sm text-[var(--muted)]">
            No se afirma un plazo legal fijo de retención: los datos permanecen hasta que se eliminen o se solicite el borrado.
          </p>

          <h2 className="mt-8 text-lg font-semibold text-[var(--ink)]">2. Cómo solicitarlo (sin correo inventado)</h2>
          <p>
            El repositorio no publica un correo de soporte verificado. El canal válido es el administrador de la
             instalación que utiliza:
          </p>
          <ol className="mt-3 list-decimal space-y-2 pl-5">
            <li>
               Inicie sesión en Horarium y, si su instancia lo expone, abra <strong className="text-[var(--ink)]">Administración</strong> o
               contacte directamente a la persona que opera el despliegue (Vercel/Supabase) de su universidad o grupo.
            </li>
            <li>
               Envíe una solicitud explícita indicando el <strong className="text-[var(--ink)]">email de la cuenta</strong> y, si vinculó
              WhatsApp, el <strong className="text-[var(--ink)]">número en formato internacional</strong> (waId). Ejemplo de texto:
              &quot;Solicito la eliminación completa de mi cuenta {`{email}` } y de mis datos asociados en Horarium, incluido
              WhatsApp {`{número}` } si corresponde.&quot;
            </li>
            <li>
               El administrador verificará que usted es titular (le pedirá confirmar desde la sesión iniciada o reenviando el
              mismo email) y luego borrará los registros en Supabase Dashboard (Auth &gt; Users y tablas listadas arriba) y en
              Google Drive/Meta si aplica.
            </li>
          </ol>
          <p className="mt-3 text-sm text-[var(--muted)]">
            Si el operador de su instancia publicó un contacto (por ejemplo en la pantalla de login o documentación
            interna), utilice ese contacto. No utilice direcciones genéricas no verificadas.
          </p>

          <h2 className="mt-8 text-lg font-semibold text-[var(--ink)]">3. Qué hace el administrador (pasos verificables)</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              En Supabase: elimina el usuario en <em>Authentication → Users</em> (cascada en{" "}
              <code className="rounded bg-[var(--soft)] px-1 py-0.5 text-xs">profiles</code>) y borra filas residuales en{" "}
              <code className="rounded bg-[var(--soft)] px-1 py-0.5 text-xs">notes</code>,{" "}
              <code className="rounded bg-[var(--soft)] px-1 py-0.5 text-xs">note_comments</code>,{" "}
              <code className="rounded bg-[var(--soft)] px-1 py-0.5 text-xs">academic_events</code>,{" "}
              <code className="rounded bg-[var(--soft)] px-1 py-0.5 text-xs">notifications</code> y Storage objects donde{" "}
              <code className="rounded bg-[var(--soft)] px-1 py-0.5 text-xs">author_id / user_id</code> sea el suyo.
            </li>
            <li>
              En WhatsApp: borra <code className="rounded bg-[var(--soft)] px-1 py-0.5 text-xs">whatsapp_identities where phone = waId</code> y
              registros de <code className="rounded bg-[var(--soft)] px-1 py-0.5 text-xs">whatsapp_messages / conversations</code>.
            </li>
            <li>En Drive: elimina archivos creados por la integración si los hubiera (opcional según configuración).</li>
            <li>Confirma por el mismo canal de la solicitud que el borrado se completó.</li>
          </ul>

          <h2 className="mt-8 text-lg font-semibold text-[var(--ink)]">4. Plazos y confirmación</h2>
          <p>
            El borrado es manual, no automático. El administrador debe ejecutarlo en cuanto le sea posible y confirmarte
             el resultado. No se declara un SLA fabricado. Mientras tanto puede archivar o eliminar directamente sus notas,
            eventos y adjuntos desde la app.
          </p>

          <h2 className="mt-8 text-lg font-semibold text-[var(--ink)]">5. Alternativa de autoservicio parcial</h2>
          <p>
             Puede borrar o archivar su contenido desde Notas y Eventos, eliminar comentarios y quitar su avatar antes de
            pedir el borrado total. Esto no elimina la cuenta de Auth ni la identidad de WhatsApp, que requieren la
            acción del administrador descrita arriba.
          </p>

          <hr className="my-8 border-[var(--line)]" />
          <p className="text-sm text-[var(--muted)]">
            Dudas sobre privacidad: consulte la{" "}
            <Link href="/privacy#eliminacion" className="underline underline-offset-4">
              sección de eliminación en la política de privacidad
            </Link>{" "}
            y los{" "}
            <Link href="/terms" className="underline underline-offset-4">
              términos
            </Link>
            . Esta página satisface el requisito de Meta de disponer de una URL pública y accesible sin autenticación
            que explique la eliminación de datos de usuario.
          </p>
        </article>
      </div>
    </main>
  );
}
