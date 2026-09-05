import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Términos de servicio — Horarium",
  description: "Condiciones de uso de Horarium: cuentas, contenido académico, roles y uso del bot de WhatsApp.",
};

const updated = "4 de septiembre de 2026";

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-12">
        <header className="mb-8">
          <Link href="/" className="text-sm font-medium text-[var(--accent)] hover:underline">
            ← Volver a Horarium
          </Link>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-[var(--ink)]">Términos de servicio</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">Actualizados el {updated}.</p>
          <nav className="mt-4 flex flex-wrap gap-3 text-sm">
            <Link href="/privacy" className="underline decoration-[var(--line)] underline-offset-4 hover:text-[var(--ink)]">
              Privacidad
            </Link>
            <Link href="/data-deletion" className="underline decoration-[var(--line)] underline-offset-4 hover:text-[var(--ink)]">
              Eliminación de datos
            </Link>
          </nav>
        </header>

        <article className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 sm:p-8 leading-relaxed text-[15px]">
          <p className="text-[var(--ink)]">
            Horarium es una aplicación de horario universitario semanal, notas y eventos académicos con un bot opcional
            de WhatsApp. Al usar la aplicación acepta estos términos, que reflejan el comportamiento real del sistema y
            no prometen integraciones, garantías o entidades que no existen en el repositorio.
          </p>

          <h2 className="mt-8 text-lg font-semibold text-[var(--ink)]">1. Descripción del servicio</h2>
          <p>
            Horario público por materias/profesores/aulas; notas colaborativas con bloques, etiquetas y adjuntos;
            eventos académicos (parcial, entrega, recuperatorio, exposición, otro) con estados pendiente/completado/cancelado
            y modelo individual/grupal; notificaciones y panel de administración para catálogos. Un cron diario archiva
            notas vivas si <code className="rounded bg-[var(--soft)] px-1 py-0.5 text-xs">LIVE_NOTES_ENABLED</code> está activo.
          </p>

          <h2 className="mt-8 text-lg font-semibold text-[var(--ink)]">2. Cuentas y roles</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>La cuenta se crea vía Supabase Auth. Es responsable de custodiar sus credenciales y su alias/avatar.</li>
            <li>
              Los roles son <code className="rounded bg-[var(--soft)] px-1 py-0.5 text-xs">user</code> y{" "}
              <code className="rounded bg-[var(--soft)] px-1 py-0.5 text-xs">admin</code>. Un administrador se promueve manualmente con
              <code className="rounded bg-[var(--soft)] px-1 py-0.5 text-xs">update profiles set role=&apos;admin&apos;</code> y gestiona catálogos y
              horarios.
            </li>
            <li>Sin Supabase configurado la app opera en modo local de demostración, sin persistencia compartida.</li>
          </ul>

          <h2 className="mt-8 text-lg font-semibold text-[var(--ink)]">3. Contenido del usuario</h2>
          <p>
             El contenido que crea (notas, comentarios, eventos, adjuntos) sigue siendo suyo. Otorga a Horarium una
            licencia limitada para almacenarlo y mostrarlo a usuarios autenticados según las políticas RLS vigentes
            (lectura pública de catálogos y horarios; lectura autenticada de notas y adjuntos; edición/borrado solo del
            autor o admin). Es responsable de que su contenido no infrinja derechos de terceros.
          </p>

          <h2 className="mt-8 text-lg font-semibold text-[var(--ink)]">4. Uso aceptable</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
             <li>No intente eludir RLS, suplantar usuarios ni exceder límites (contenido 2000 caracteres, adjuntos 10 MB, webhook 1 MB).</li>
             <li>No utilice la plataforma para spam, acoso o distribución de material ilícito.</li>
             <li>El bot de WhatsApp requiere confirmación explícita (sí/no) para mutaciones; no lo utilice para automatizar la elusión de esa confirmación.</li>
          </ul>

          <h2 className="mt-8 text-lg font-semibold text-[var(--ink)]">5. Integraciones opcionales</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              <strong className="text-[var(--ink)]">WhatsApp:</strong> requiere vincular su número con un código de 6 dígitos válido 10
              minutos (<code className="rounded bg-[var(--soft)] px-1 py-0.5 text-xs">/api/whatsapp/link-code</code>) y verificar firma HMAC. La
              reasociación a otra cuenta exige confirmación en el chat. El envío usa{" "}
              <code className="rounded bg-[var(--soft)] px-1 py-0.5 text-xs">WHATSAPP_PHONE_NUMBER_ID</code> y{" "}
              <code className="rounded bg-[var(--soft)] px-1 py-0.5 text-xs">WHATSAPP_ACCESS_TOKEN</code>.
            </li>
            <li>
              <strong className="text-[var(--ink)]">DeepSeek:</strong> interpreta mensajes de WhatsApp para producir borradores
              estructurados; puede no estar configurado y el sistema recurre a heurística local limitada.
            </li>
            <li>
              <strong className="text-[var(--ink)]">Google Drive:</strong> crea documentos vivos por materia y asigna permisos si el
              operador configuró credenciales; si no, la función no está disponible.
            </li>
            <li>Cada integración está sujeta a los términos del proveedor correspondiente.</li>
          </ul>

          <h2 className="mt-8 text-lg font-semibold text-[var(--ink)]">6. Disponibilidad y garantías</h2>
          <p>
            El servicio se ofrece &quot;tal cual&quot;, sin garantía de disponibilidad continua, exactitud del horario demo ni ausencia
            de errores. El operador de la instancia puede suspender o modificar funciones para mantenimiento o cumplimiento
            legal.
          </p>

          <h2 className="mt-8 text-lg font-semibold text-[var(--ink)]">7. Terminación</h2>
          <p>
             Puede dejar de usar la aplicación y pedir la eliminación de su cuenta según la{" "}
            <Link href="/data-deletion" className="font-medium text-[var(--accent)] hover:underline">
              página de eliminación
            </Link>
            . El administrador puede suspender cuentas que violen estos términos. La eliminación se ejecuta manualmente
            por el administrador en Supabase Auth y tablas asociadas; no es automática ni instantánea.
          </p>

          <h2 className="mt-8 text-lg font-semibold text-[var(--ink)]">8. Limitación de responsabilidad</h2>
          <p>
            En la máxima medida permitida por la ley, Horarium y el operador de la instancia no responden por daños
            indirectos, pérdida de datos o errores derivados de integraciones de terceros o del uso del modo local sin
            respaldo.
          </p>

          <h2 className="mt-8 text-lg font-semibold text-[var(--ink)]">9. Cambios</h2>
          <p>
            Estos términos pueden actualizarse para reflejar cambios funcionales o legales. La fecha de actualización
            siempre figura al inicio. Continuar usando el servicio tras un cambio implica aceptación.
          </p>

          <hr className="my-8 border-[var(--line)]" />
          <p className="text-sm text-[var(--muted)]">
            Para datos personales y derechos, consulte la{" "}
            <Link href="/privacy" className="underline underline-offset-4">
              política de privacidad
            </Link>
            . Dudas sobre la implementación: remítase al administrador de la instancia desplegada.
          </p>
        </article>
      </div>
    </main>
  );
}
