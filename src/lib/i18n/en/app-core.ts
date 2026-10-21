import type { Dictionary } from "./types";

/** Shell de la app, resumen, acceso, ajustes y textos compartidos de la app. */
export const APP_CORE: Dictionary = {
  // AppShell: menú lateral (rótulos de `navigationFor`)
  "Resumen": "Dashboard",
  "Buscar": "Search",
  "Solicitudes": "Requests",
  "Disponibilidad": "Availability",
  "Perfil": "Profile",
  "Referencias": "References",
  "Acceso": "Access",
  "Ajustes": "Settings",
  "Notificaciones": "Notifications",
  "Navegación del perfil": "Profile navigation",

  // AppShell: estados de acceso y del perfil
  "Activo": "Active",
  "Vencido": "Expired",
  "Suspendido": "Suspended",
  "Inactivo": "Inactive",
  "Borrador": "Draft",
  "Publicado": "Published",
  "Sin fecha definida": "No date set",

  // AppShell: AccessPanel
  "Buscar profesionales": "Search professionals",
  "Enviar solicitudes": "Send requests",
  "Publicar disponibilidad": "Publish availability",
  "Recibir solicitudes": "Receive requests",
  "Usar galería": "Use gallery",
  "Consultar historial": "View history",
  "Rechazar solicitudes pendientes": "Decline pending requests",
  "Estado efectivo": "Effective status",
  "Acceso del perfil": "Profile access",
  // Igual que en el backoffice (admin): la misma vigencia de la habilitación.
  "Vigencia": "Validity",
  "Desde": "From",
  "Hasta": "To",
  "Sin vencimiento definido": "No expiry date set",
  "Evaluado": "Evaluated",
  "Capacidades": "Capabilities",
  "Solicitudes del mes": "Requests this month",
  "{used} utilizadas · sin límite definido": "{used} used · no limit set",
  "{used} utilizadas · {remaining} disponibles": "{used} used · {remaining} available",
  "Funciones restringidas": "Restricted features",
  "Este perfil está suspendido. Solo podés consultar este estado, contactar soporte y cerrar sesión.":
    "This profile is suspended. You can only view this status, contact support and log out.",
  "La vigencia finalizó. Los datos propios se conservan y las funciones habilitadas se indican arriba.":
    "The validity period has ended. Your data is kept and the features still enabled are shown above.",
  "Este perfil todavía no tiene habilitación efectiva. Tus datos y el estado del proceso se conservan.":
    "This profile doesn't have an active access grant yet. Your data and progress are kept.",
  // Una sola forma en español: el inglés evita el plural para servir con cualquier número.
  "{count} capacidades están bloqueadas en este momento.": "Capabilities blocked right now: {count}.",
  "Contactar soporte": "Contact support",

  // AppShell: ProfileOverview
  "Completá la información del perfil para presentarte ante la red profesional.":
    "Complete your profile details to introduce yourself to the professional network.",
  "Paso de alta {step} de 4": "Setup step {step} of 4",
  "No disponible": "Not available",
  "Funciones activas según capacidades.": "Features enabled according to capabilities.",
  "Consultá la pantalla de acceso para ver el detalle.": "Check the access screen for details.",
  "Ciudades": "Cities",
  "Todavía no seleccionaste ciudades.": "You haven't selected any cities yet.",
  "Tu perfil sigue en borrador": "Your profile is still a draft",
  "Retomá el alta desde el último paso guardado.": "Resume setup from the last saved step.",
  "Retomar alta": "Resume setup",

  // AppShell: SuspendedProfileNotice, carga y errores
  "Perfil suspendido": "Profile suspended",
  "Esta sección no está disponible": "This section isn't available",
  "Mientras el perfil esté suspendido solo podés consultar su estado de acceso, tus notificaciones y los ajustes de la cuenta, contactar soporte o cerrar la sesión.":
    "While the profile is suspended you can only view its access status, your notifications and account settings, contact support or log out.",
  "Ver estado de acceso": "View access status",
  "Cargando perfil": "Loading profile",
  "No pudimos cargar tu cuenta.": "We couldn't load your account.",
  "No pudimos cargar el perfil.": "We couldn't load the profile.",
  "La evaluación de acceso no está disponible.": "The access check isn't available.",

  // AppShell: header y estados de la cuenta
  "Perfil activo": "Active profile",
  "Cargando tu cuenta…": "Loading your account…",
  "No pudimos abrir tu cuenta": "We couldn't open your account",
  "Cuenta suspendida": "Account suspended",
  "Tu navegación está restringida": "Your access is restricted",
  "Podés contactar soporte o cerrar la sesión. No se muestran datos operativos del perfil.":
    "You can contact support or log out. Operational profile data isn't shown.",
  "Primer perfil": "First profile",
  "Creá tu perfil profesional": "Create your professional profile",
  "Tu cuenta está lista. El alta guarda cada etapa y no concede habilitación automática.":
    "Your account is ready. Setup saves each step and doesn't grant access automatically.",
  "Crear perfil": "Create profile",
  "No pudimos cargar el perfil": "We couldn't load the profile",
  "No pudimos consultar el estado de acceso": "We couldn't check the access status",
  "Acceso no disponible": "Access unavailable",
  "Falló la consulta al endpoint integrado de acceso. No se infirió ningún permiso.":
    "The request to the access endpoint failed. No permissions were inferred.",
  "Podés consultar los datos del perfil, pero los cambios quedan bloqueados mientras dure la suspensión.":
    "You can view the profile details, but changes are blocked while the suspension lasts.",

  // ConfirmDialog
  "Volver": "Back",
  "Procesando…": "Processing…",

  // DashboardMetrics
  "Indicadores del perfil": "Profile metrics",
  "Datos reales de este perfil. No suman tus otros perfiles.":
    "Actual data for this profile. Your other profiles aren't included.",
  "Cargando indicadores…": "Loading metrics…",
  "No pudimos cargar los indicadores": "We couldn't load the metrics",
  "Probá de nuevo en unos segundos. El resto del resumen sigue disponible.":
    "Try again in a few seconds. The rest of the dashboard is still available.",
  "No podés ver los indicadores en este momento": "You can't view the metrics right now",
  "Este perfil no está disponible": "This profile isn't available",
  "No encontramos el perfil activo en tu cuenta. Elegí otro perfil desde el selector.":
    "We couldn't find the active profile in your account. Choose another profile from the selector.",
  "No pudimos actualizar los indicadores. Mostramos los últimos datos confirmados.":
    "We couldn't update the metrics. Showing the last confirmed data.",
  "Todavía no hay indicadores para este perfil.": "There are no metrics for this profile yet.",

  // dashboardModel: indicadores
  "Solicitudes pendientes": "Pending requests",
  "Esperan una respuesta.": "Awaiting a response.",
  "Ver solicitudes pendientes": "View pending requests",
  "Solicitudes aceptadas": "Accepted requests",
  "Contacto liberado entre las partes. No implica una contratación.":
    "Contact details shared between both parties. It doesn't imply a booking.",
  "Ver solicitudes aceptadas": "View accepted requests",
  "Solicitudes rechazadas": "Declined requests",
  "Se respondieron sin liberar el contacto.": "Answered without sharing contact details.",
  "Ver solicitudes rechazadas": "View declined requests",
  "Solicitudes vencidas": "Expired requests",
  "Vencieron sin respuesta.": "Expired without a response.",
  "Ver solicitudes vencidas": "View expired requests",
  "Notificaciones sin leer": "Unread notifications",
  "Del perfil y de tu cuenta.": "From the profile and your account.",
  "Ver notificaciones sin leer": "View unread notifications",
  "Referencias publicadas": "Published references",
  "Recibidas y visibles en tu ficha.": "Received and visible on your profile page.",
  "Ver referencias recibidas": "View received references",
  "Días disponibles a futuro": "Upcoming available days",
  "Fechas publicadas desde mañana.": "Dates published from tomorrow onwards.",
  "Ver disponibilidad": "View availability",

  // SettingsView
  "No pudimos guardar por un problema de conexión. Probá de nuevo.":
    "We couldn't save because of a connection problem. Please try again.",
  "Hiciste demasiados intentos seguidos. Esperá un momento y volvé a probar.":
    "Too many attempts in a row. Wait a moment and try again.",
  "Revisá los datos del formulario.": "Please check the form details.",
  "Tu cuenta está suspendida y no puede realizar esta acción.":
    "Your account is suspended and can't perform this action.",
  "Cuenta": "Account",
  "Estos ajustes son de tu cuenta y se aplican a todos tus perfiles, no solo al perfil activo.":
    "These settings belong to your account and apply to all your profiles, not just the active one.",
  "Ingresá un nombre de entre {min} y {max} caracteres.": "Enter a name between {min} and {max} characters long.",
  "Guardamos el nombre de tu cuenta.": "We've saved your account name.",
  "No pudimos guardar el nombre.": "We couldn't save the name.",
  "Datos de la cuenta": "Account details",
  "Email actual": "Current email",
  "Verificación": "Verification",
  "Email verificado": "Email verified",
  "Email sin verificar": "Email not verified",
  "El email se cambia desde “Cambiar email” y se confirma con un enlace.":
    "You change your email under “Change email” and confirm it with a link.",
  "Nombre": "Name",
  "Guardando…": "Saving…",
  "Guardar nombre": "Save name",
  "Ingresá el nuevo email.": "Enter the new email.",
  "Ingresá tu contraseña actual.": "Enter your current password.",
  "Te enviamos un enlace a {email} para confirmar el cambio. Hasta entonces seguís usando {current}.":
    "We've sent a link to {email} to confirm the change. Until then you'll keep using {current}.",
  "Ese email no está disponible. Probá con otra dirección.": "That email isn't available. Try a different address.",
  "No pudimos solicitar el cambio de email.": "We couldn't request the email change.",
  "Cambiar email": "Change email",
  "Te enviamos un enlace al email nuevo. El cambio se aplica recién cuando lo confirmás; después avisamos al email anterior.":
    "We'll send a link to the new email. The change only applies once you confirm it; then we let your previous email know.",
  "Nuevo email": "New email",
  "Contraseña actual": "Current password",
  "La pedimos para confirmar que sos vos.": "We ask for it to confirm it's you.",
  "Enviando…": "Sending…",
  "Enviar enlace de confirmación": "Send confirmation link",
  "La nueva contraseña debe tener entre {min} y {max} caracteres.":
    "The new password must be between {min} and {max} characters long.",
  "La confirmación no coincide con la nueva contraseña.": "The confirmation doesn't match the new password.",
  "Actualizamos tu contraseña. Por seguridad cerramos todas tus sesiones, incluida esta. Te llevamos a iniciar sesión con la contraseña nueva…":
    "We've updated your password. For security we've logged you out of all sessions, including this one. Taking you to log in with your new password…",
  "No pudimos cambiar la contraseña.": "We couldn't change the password.",
  "Cambiar contraseña": "Change password",
  "Al cambiarla cerramos todas tus sesiones abiertas, incluida esta, y tenés que volver a ingresar.":
    "Changing it logs you out of all open sessions, including this one, and you'll need to log in again.",
  "Nueva contraseña": "New password",
  "Entre {min} y {max} caracteres.": "Between {min} and {max} characters.",
  "Repetí la nueva contraseña": "Repeat the new password",
  "Cambiando…": "Changing…",
};
