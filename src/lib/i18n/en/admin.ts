import type { Dictionary } from "./types";

/** Backoffice. */
export const ADMIN: Dictionary = {
  // api.ts — rótulos de estados, auditoría y fechas
  "Activa": "Active",
  "Suspendida": "Suspended",
  "Borrador": "Draft",
  "Publicado": "Published",
  "Suspendido": "Suspended",
  "Inactivo": "Inactive",
  "Activo": "Active",
  "Vencido": "Expired",
  "Pendiente de revisión": "Pending review",
  "Aprobado": "Approved",
  "Rechazado": "Rejected",
  "Cuenta": "Account",
  "Perfil": "Profile",
  "Documento de perfil": "Profile document",
  "Galería de perfil": "Profile gallery",
  "Referencia": "Reference",
  "Habilitación manual reemplazada": "Access grant replaced",
  "Documento aprobado": "Document approved",
  "Documento rechazado": "Document rejected",
  "Documento cargado": "Document uploaded",
  "Documento retirado": "Document withdrawn",
  "Cuenta suspendida": "Account suspended",
  "Cuenta reactivada": "Account reactivated",
  "Perfil suspendido": "Profile suspended",
  "Perfil restaurado": "Profile restored",
  "Imagen principal reemplazada": "Main image replaced",
  "Imagen agregada a la galería": "Image added to the gallery",
  "Imagen eliminada de la galería": "Image removed from the gallery",
  "Referencia ocultada por moderación": "Reference hidden by moderation",
  "Referencia restaurada por moderación": "Reference restored by moderation",
  "Sin fecha": "No date",
  "Sin vencimiento": "No expiry",
  "vigente": "valid",
  "sin vigencia actual": "not currently valid",
  "{date} (hora de Argentina)": "{date} (Argentina time)",

  // AdminShell
  "Panel": "Dashboard",
  "Cuentas": "Accounts",
  "Perfiles": "Profiles",
  "Documentos": "Documents",
  "Referencias": "References",
  "Auditoría": "Audit log",
  "Navegación del backoffice": "Back office navigation",
  "Administración": "Admin",
  "No pudimos verificar tu cuenta.": "We couldn't verify your account.",
  "Backoffice": "Back office",
  "Verificando tu cuenta…": "Checking your account…",
  "Redirigiendo…": "Redirecting…",
  "No pudimos abrir el backoffice": "We couldn't open the back office",
  "El backoffice está restringido": "The back office is restricted",
  "Tu cuenta tiene rol de administración pero está suspendida, así que el backend rechaza toda consulta administrativa. Podés contactar soporte o cerrar la sesión.":
    "Your account has an admin role but is suspended, so the backend rejects every admin request. You can contact support or log out.",
  "Contactar soporte": "Contact support",

  // AdminFeedback
  "Acceso": "Access",
  "Documento": "Document",
  "No tenés permisos sobre esta información": "You don't have permission to view this information",
  "El backend respondió 403 para esta consulta administrativa. No es un listado vacío: los datos existen pero tu cuenta no puede leerlos. La autorización la decide el backend, no esta pantalla.":
    "The backend returned 403 for this admin request. This isn't an empty list: the data exists but your account can't read it. The backend decides authorisation, not this screen.",
  "Cambio aplicado y listado actualizado": "Change applied and list refreshed",
  "Cambio aplicado; el listado no se pudo refrescar": "Change applied; the list couldn't be refreshed",
  "El cambio quedó guardado y auditado en el backend. Lo único que falló fue volver a leer el listado, así que lo que ves debajo puede estar desactualizado. Reintentá la actualización; no repitas la acción.":
    "The change was saved and audited in the backend. Only reloading the list failed, so what you see below may be out of date. Try refreshing again; don't repeat the action.",
  "Reintentar actualización del listado": "Try refreshing the list again",
  "Página {page}": "Page {page}",
  "{count} registros en pantalla": "Records on screen: {count}",
  "{total} en total": "{total} in total",
  "última página": "last page",
  "Paginación por cursor": "Cursor pagination",
  "Página anterior": "Previous page",
  "Página siguiente": "Next page",

  // AdminDialog y StatusChangeDialog
  "El motivo es obligatorio y necesita al menos {min} caracteres. No se acepta vacío ni solo espacios.":
    "A reason is required and needs at least {min} characters. Empty or whitespace-only text isn't accepted.",
  "Motivo (obligatorio)": "Reason (required)",
  "Queda registrado en la auditoría junto con el cambio de estado. Entre {min} y {max} caracteres.":
    "Recorded in the audit log together with the status change. Between {min} and {max} characters.",
  "Cancelar": "Cancel",
  "Aplicando…": "Applying…",

  // DocumentReviewDialog
  "El documento queda aprobado y la verificación del perfil se recalcula con los documentos obligatorios aprobados y vigentes. No concede acceso: la habilitación depende del grant manual del perfil. Aprobar no admite motivo, así que no se envía ninguno.":
    "The document is approved and the profile's verification is recalculated from its approved, valid required documents. It doesn't grant access: that depends on the profile's manual access grant. Approving takes no reason, so none is sent.",
  "El documento queda rechazado y deja de contar para la verificación del perfil. El titular puede cargar un reemplazo. Rechazar no suspende el perfil ni toca su grant de acceso.":
    "The document is rejected and no longer counts towards the profile's verification. The owner can upload a replacement. Rejecting doesn't suspend the profile or touch its access grant.",
  "Rechazar el documento": "Reject the document",
  "Aprobar el documento": "Approve the document",
  "Vigencia declarada: {validity}.": "Declared validity: {validity}.",
  "Motivo del rechazo (obligatorio)": "Reason for rejection (required)",
  "Lo lee el titular del perfil y queda en la auditoría. Entre {min} y {max} caracteres.":
    "The profile owner reads it and it's kept in the audit log. Between {min} and {max} characters.",
  "Rechazar documento": "Reject document",
  "Aprobar documento": "Approve document",

  // AccessGrantDialog
  "Habilitación manual del perfil: define desde cuándo y hasta cuándo puede operar y con qué capacidades. No es un pago ni una suscripción, no se renueva sola y no cambia el estado del perfil, que se administra aparte. El motivo y el cambio quedan en la auditoría.":
    "Manual access grant for the profile: it sets from when and until when the profile can operate, and with which capabilities. It isn't a payment or a subscription, it doesn't renew on its own and it doesn't change the profile status, which is managed separately. The reason and the change are kept in the audit log.",
  "Vacío significa sin límite. 0 bloquea la capacidad. Solo se aceptan enteros de 0 o más.":
    "Empty means no limit. 0 blocks the capability. Only whole numbers of 0 or more are accepted.",
  "Sin límite de ciudades.": "No city limit.",
  "Sin límite de solicitudes por mes.": "No limit on requests per month.",
  "El valor actual no es un entero válido.": "The current value isn't a valid whole number.",
  "Bloqueado: 0 ciudades permitidas.": "Blocked: 0 cities allowed.",
  "Bloqueado: 0 solicitudes por mes permitidas.": "Blocked: 0 requests per month allowed.",
  "Hasta 1 ciudad.": "Up to 1 city.",
  "Hasta 1 solicitud por mes.": "Up to 1 request per month.",
  "Hasta {count} ciudades.": "Up to {count} cities.",
  "Hasta {count} solicitudes por mes.": "Up to {count} requests per month.",
  "Editar la habilitación manual": "Edit the manual access grant",
  "{profile} · {category} · titular {owner}": "{profile} · {category} · owner {owner}",
  "Releyendo la habilitación…": "Reloading the access grant…",
  "Releer la habilitación y reintentar": "Reload the access grant and try again",
  "Habilitación vigente": "Current access grant",
  "El perfil no tiene habilitación registrada todavía.": "The profile has no access grant on record yet.",
  "{status} · desde {start} · hasta sin vencimiento": "{status} · from {start} · no expiry",
  "{status} · desde {start} · hasta {end}": "{status} · from {start} · until {end}",
  "Estado de acceso evaluado": "Evaluated access state",
  "Versión sobre la que vas a escribir": "Version you're about to overwrite",
  "{version} (sin habilitación previa)": "{version} (no previous access grant)",
  "Ciudades actuales del perfil": "Profile's current cities",
  "Ninguna": "None",
  "Estado de la habilitación": "Access grant status",
  "Habilitada desde": "Granted from",
  "Hora de Argentina. Vacío significa sin fecha de inicio.": "Argentina time. Empty means no start date.",
  "Habilitada hasta": "Granted until",
  "Hora de Argentina. Vacío significa sin vencimiento; la habilitación no se renueva sola.":
    "Argentina time. Empty means no expiry; the access grant doesn't renew on its own.",
  "Límite de ciudades": "City limit",
  "Límite mensual de solicitudes de contacto": "Monthly contact request limit",
  "Galería habilitada": "Gallery enabled",
  "Ciudades a conservar (obligatorio)": "Cities to keep (required)",
  "El nuevo límite queda por debajo de las {count} ciudades actuales del perfil, así que hay que elegir cuáles se conservan. Las ciudades excluidas pierden sus disponibilidades futuras: el backend las bloquea en la misma operación y no se recuperan solas. Nadie elige por vos y la lista no se recorta automáticamente.":
    "The new limit is below the profile's {count} current cities, so you have to choose which ones to keep. Excluded cities lose their future availability: the backend blocks it in the same operation and it doesn't come back on its own. Nobody chooses for you and the list isn't trimmed automatically.",
  "{city} · ciudad principal": "{city} · main city",
  "Conservás {kept} de {total} ciudades; el nuevo límite permite hasta {limit}.":
    "You're keeping {kept} of {total} cities; the new limit allows up to {limit}.",
  "Pierden disponibilidad futura: {cities}.": "Losing future availability: {cities}.",
  "La selección supera el nuevo límite, así que el backend va a rechazarla. Quitá ciudades o subí el límite antes de confirmar.":
    "The selection exceeds the new limit, so the backend will reject it. Remove cities or raise the limit before confirming.",
  "Sin ninguna ciudad seleccionada el perfil queda sin ciudades y todas pierden disponibilidad futura. Si no es lo que buscás, elegí las que se conservan.":
    "With no city selected the profile is left without cities and all of them lose future availability. If that's not what you want, choose the ones to keep.",
  "Con límite 0 no queda ninguna ciudad por conservar: se envía una selección vacía.":
    "With a limit of 0 there are no cities to keep: an empty selection is sent.",
  "El perfil no tiene ciudades cargadas.": "The profile has no cities.",
  "Queda registrado en la auditoría junto con la habilitación. Entre {min} y {max} caracteres.":
    "Recorded in the audit log together with the access grant. Between {min} and {max} characters.",
  "Guardar habilitación": "Save access grant",

  // SafeChanges
  "sin valor": "no value",
  "sí": "yes",
  "no": "no",
  "texto vacío": "empty text",
  "lista vacía": "empty list",
  "sin datos": "no data",
  "El evento no registró cambios detallados.": "The event didn't record detailed changes.",

  // UsersPanel
  "El backend protege las cuentas administradoras: una cuenta con rol de administración no puede quedar suspendida desde el backoffice. El estado de la cuenta no cambió.":
    "The backend protects admin accounts: an account with an admin role can't be suspended from the back office. The account status didn't change.",
  "Suspender la cuenta": "Suspend the account",
  "Reactivar la cuenta": "Reactivate the account",
  "La cuenta conserva sus datos y solo podrá consultar su estado, contactar soporte y cerrar sesión. No se modifica ningún grant de acceso de sus perfiles.":
    "The account keeps its data and can only check its status, contact support and log out. No access grant on its profiles is changed.",
  "La cuenta vuelve a operar con los permisos que ya tenía. Reactivar no concede habilitación a sus perfiles: eso depende del grant de cada perfil.":
    "The account can operate again with the permissions it already had. Reactivating doesn't give its profiles access: that depends on each profile's access grant.",
  "La consulta fue rechazada.": "The request was rejected.",
  "No pudimos listar las cuentas.": "We couldn't list the accounts.",
  "No tenés permisos para cambiar el estado de esta cuenta. {detail}": "You don't have permission to change this account's status. {detail}",
  "El backend rechazó la operación.": "The backend rejected the operation.",
  "No pudimos cambiar el estado de la cuenta.": "We couldn't change the account status.",
  "La cuenta «{name}» quedó en estado {status}. El motivo se registró en la auditoría.":
    "The account “{name}” is now {status}. The reason was recorded in the audit log.",
  "Búsqueda por nombre o correo, filtro por estado de la cuenta y suspensión o reactivación con motivo obligatorio. El motivo queda en la auditoría del backend.":
    "Search by name or email, filter by account status, and suspend or reactivate with a required reason. The reason is kept in the backend audit log.",
  "Filtros de cuentas": "Account filters",
  "Buscar por nombre o correo": "Search by name or email",
  "Estado de la cuenta": "Account status",
  "Todos los estados": "All statuses",
  "Aplicar filtros": "Apply filters",
  "Limpiar": "Clear",
  "Consultando cuentas…": "Loading accounts…",
  "No pudimos listar las cuentas": "We couldn't list the accounts",
  "Ninguna cuenta coincide con los filtros aplicados.": "No accounts match the applied filters.",
  "{count} cuentas en esta página.": "Accounts on this page: {count}.",
  "Correo": "Email",
  "Rol de sistema": "System role",
  "Usuario": "User",
  "Correo verificado": "Email verified",
  "Sin verificar": "Not verified",
  "Alta": "Created",
  "Suspender cuenta": "Suspend account",
  "Reactivar cuenta": "Reactivate account",
  "Cuenta de administración: el backoffice no ofrece suspenderla y el backend la protege con un conflicto si se intenta.":
    "Admin account: the back office doesn't offer to suspend it, and the backend blocks any attempt with a conflict.",

  // ProfilesPanel
  "El perfil deja de operar y la suspensión prevalece sobre cualquier habilitación. No modifica el grant de acceso: el grant queda como está y su versión no cambia.":
    "The profile stops operating and the suspension overrides any access grant. It doesn't change the access grant: the grant stays as it is and its version doesn't change.",
  "Se pide sacar al perfil de la suspensión. Si nunca completó el alta, el backend lo devuelve a Borrador en lugar de publicarlo. Restaurar tampoco concede acceso: el grant no se toca.":
    "This asks to lift the profile's suspension. If it never completed onboarding, the backend returns it to Draft instead of publishing it. Restoring doesn't grant access either: the grant isn't touched.",
  "Otra persona modificó esta habilitación mientras la editabas, así que la versión que enviaste ya no es la vigente y el backend no aplicó ningún cambio. Releé la habilitación para ver los valores actuales y volvé a confirmar; no la reenviamos con la versión nueva por tu cuenta.":
    "Someone else changed this access grant while you were editing it, so the version you sent is no longer current and the backend didn't apply any change. Reload the access grant to see the current values and confirm again; we don't resend it with the new version on your behalf.",
  "El grant de acceso no se modificó: sigue en {state}.": "The access grant wasn't changed: it's still {state}.",
  "El perfil «{name}» quedó en estado {status}. {access}": "The profile “{name}” is now {status}. {access}",
  "El perfil «{name}» salió de la suspensión y quedó en estado {status}. Restaurar no concede acceso. {access}":
    "The profile “{name}” is no longer suspended and is now {status}. Restoring doesn't grant access. {access}",
  "Pediste restaurar y publicar el perfil «{name}», pero el backend lo devolvió en estado {status} porque nunca completó el alta, así que no se publicó. Mostramos el estado real de la respuesta. {access}":
    "You asked to restore and publish the profile “{name}”, but the backend returned it as {status} because it never completed onboarding, so it wasn't published. We're showing the actual status from the response. {access}",
  "sin habilitación": "no access grant",
  "La habilitación de «{name}» quedó en {grant}, versión {version}, con vigencia hasta {date}. Estado de acceso evaluado: {state}. El estado del perfil no cambió: sigue en {status}.":
    "The access grant for “{name}” is now {grant}, version {version}, valid until {date}. Evaluated access state: {state}. The profile status didn't change: it's still {status}.",
  "La habilitación de «{name}» quedó en {grant}, versión {version}, con vigencia sin vencimiento. Estado de acceso evaluado: {state}. El estado del perfil no cambió: sigue en {status}.":
    "The access grant for “{name}” is now {grant}, version {version}, with no expiry. Evaluated access state: {state}. The profile status didn't change: it's still {status}.",
  "Se conservaron {kept} de {total} ciudades y las excluidas quedaron sin disponibilidad futura.":
    "{kept} of {total} cities were kept and the excluded ones lost their future availability.",
  "No pudimos listar los perfiles.": "We couldn't list the profiles.",
  "El backend rechazó la transición por el estado del recurso ({code}). {detail}":
    "The backend rejected the transition because of the resource's state ({code}). {detail}",
  "conflicto": "conflict",
  "El estado del perfil no cambió.": "The profile status didn't change.",
  "No tenés permisos para cambiar el estado de este perfil. {detail}": "You don't have permission to change this profile's status. {detail}",
  "No pudimos cambiar el estado del perfil.": "We couldn't change the profile status.",
  "El perfil ya no aparece en esta consulta, así que no pudimos releer su habilitación. Cerrá el formulario y volvé a buscarlo.":
    "The profile no longer appears in this query, so we couldn't reload its access grant. Close the form and search for it again.",
  "Releímos la habilitación: la versión vigente ahora es {version} y el formulario muestra esos valores. Revisalos y confirmá de nuevo.":
    "We reloaded the access grant: the current version is now {version} and the form shows those values. Review them and confirm again.",
  "No pudimos releer la habilitación.": "We couldn't reload the access grant.",
  "El backend respondió: {detail}": "The backend replied: {detail}",
  "sin detalle.": "no details.",
  "Revisá los campos marcados.": "Check the highlighted fields.",
  "No tenés permisos para editar la habilitación de este perfil. {detail}": "You don't have permission to edit this profile's access grant. {detail}",
  "No pudimos guardar la habilitación.": "We couldn't save the access grant.",
  "El estado del perfil y el estado de acceso son dos cosas distintas y se filtran por separado: el primero describe la ficha, el segundo la habilitación vigente. Suspender un perfil no toca su grant y restaurarlo no concede acceso. La habilitación manual se edita con su propia acción, que sí reemplaza el grant y sube su versión sin mover el estado del perfil.":
    "Profile status and access state are two different things and are filtered separately: the first describes the listing, the second the current access grant. Suspending a profile doesn't touch its grant and restoring it doesn't grant access. The manual access grant is edited with its own action, which does replace the grant and bump its version without changing the profile status.",
  "Filtros de perfiles": "Profile filters",
  "Buscar por nombre": "Search by name",
  "Categoría": "Category",
  "Todas las categorías": "All categories",
  "Estado del perfil": "Profile status",
  "Todos los estados de perfil": "All profile statuses",
  "Estado de acceso": "Access state",
  "Todos los estados de acceso": "All access states",
  "Consultando perfiles…": "Loading profiles…",
  "No pudimos listar los perfiles": "We couldn't list the profiles",
  "Ningún perfil coincide con los filtros aplicados.": "No profiles match the applied filters.",
  "{count} perfiles en esta página.": "Profiles on this page: {count}.",
  "Titular": "Owner",
  "Estado de la cuenta titular": "Owner account status",
  "Alta completada": "Onboarding completed",
  "Sin completar · paso {step} de 4": "Not completed · step {step} of 4",
  "Ciudad principal": "Main city",
  "Sin definir": "Not set",
  "Verificación documental": "Document verification",
  "Verificado": "Verified",
  "Habilitación manual": "Manual access grant",
  "Sin habilitación registrada (versión 0)": "No access grant on record (version 0)",
  "{status} · versión {version} · sin vencimiento": "{status} · version {version} · no expiry",
  "{status} · versión {version} · hasta {date}": "{status} · version {version} · until {date}",
  "Capacidades habilitadas": "Enabled capabilities",
  "Sin capacidades definidas": "No capabilities set",
  "Ciudades: {cities} · Solicitudes por mes: {contacts} · Galería: {gallery}":
    "Cities: {cities} · Requests per month: {contacts} · Gallery: {gallery}",
  "sin límite": "no limit",
  "habilitada": "enabled",
  "no habilitada": "not enabled",
  "Restaurar perfil": "Restore profile",
  "Suspender perfil": "Suspend profile",
  "Editar habilitación": "Edit access grant",
  "El cambio de estado del perfil no altera el grant de acceso ni su versión. Editar la habilitación es la otra acción: esa sí reemplaza el grant y sube su versión, y no cambia el estado del perfil. Son dos ejes separados.":
    "Changing the profile status doesn't alter the access grant or its version. Editing the access grant is the other action: that one does replace the grant and bump its version, and it doesn't change the profile status. They're two separate axes.",
  "Suspender el perfil": "Suspend the profile",
  "Restaurar el perfil": "Restore the profile",

  // DocumentsQueuePanel
  "El documento ya no está pendiente de revisión: otra decisión se aplicó antes que esta, así que el backend no volvió a revisarlo y nada cambió ahora. Actualizá la cola para ver el estado real antes de insistir.":
    "The document is no longer pending review: another decision was applied first, so the backend didn't review it again and nothing changed now. Refresh the queue to see its actual status before trying again.",
  "El archivo del documento ya no está disponible en el almacenamiento privado, así que no hay nada que revisar ni descargar. El documento queda como está: pedile al titular una carga nueva.":
    "The document file is no longer available in private storage, so there's nothing to review or download. The document stays as it is: ask the owner for a new upload.",
  "No se puede aprobar un documento vencido: su vigencia declarada ya pasó. El documento sigue pendiente. Podés rechazarlo pidiendo un reemplazo con vigencia al día.":
    "An expired document can't be approved: its declared validity has passed. The document is still pending. You can reject it and ask for a replacement that is currently valid.",
  "Estado consultado: pendientes. Sin filtro de estado el backend devuelve solo la cola de pendientes.":
    "Status queried: pending. With no status filter the backend returns only the pending queue.",
  "Estado consultado: {status}.": "Status queried: {status}.",
  "No pudimos listar la cola documental.": "We couldn't list the document queue.",
  "No pudimos consultar los tipos documentales.": "We couldn't load the document types.",
  "No tenés permisos para revisar este documento. {detail}": "You don't have permission to review this document. {detail}",
  "No pudimos registrar la revisión del documento.": "We couldn't record the document review.",
  "El documento «{file}» ({type}) del perfil «{profile}» quedó en estado {status}. La revisión recalcula la verificación documental del perfil; no concede acceso, que sigue dependiendo de su habilitación manual.":
    "The document “{file}” ({type}) for the profile “{profile}” is now {status}. The review recalculates the profile's document verification; it doesn't grant access, which still depends on its manual access grant.",
  "La cola abre con los documentos pendientes de revisión: mientras no elijas un estado, el backend devuelve solo esa cola y no el total de documentos cargados. Aprobar o rechazar recalcula la verificación documental del perfil y nunca concede acceso.":
    "The queue opens with the documents pending review: until you choose a status, the backend returns only that queue, not every uploaded document. Approving or rejecting recalculates the profile's document verification and never grants access.",
  "Filtros de la cola documental": "Document queue filters",
  "Estado del documento": "Document status",
  "Pendientes (predeterminado del backend)": "Pending (backend default)",
  "No hay opción «todos»: la consulta devuelve un estado por vez y los estados internos que el backend usa al reemplazar una carga no son revisables.":
    "There's no “every status” option: the query returns one status at a time, and the internal statuses the backend uses when an upload is replaced can't be reviewed.",
  "Categoría del perfil": "Profile category",
  "Tipo documental": "Document type",
  "Todos los tipos documentales": "All document types",
  "Consultando tipos documentales…": "Loading document types…",
  "El filtro por tipo documental queda sin usar.": "The document type filter won't be used.",
  "No pudimos descargar el documento": "We couldn't download the document",
  "Consultando la cola documental…": "Loading the document queue…",
  "No pudimos listar la cola documental": "We couldn't list the document queue",
  "No hay documentos pendientes de revisión con estos filtros.": "No documents pending review with these filters.",
  "Ningún documento coincide con los filtros aplicados.": "No documents match the applied filters.",
  "{count} documentos en esta página.": "Documents on this page: {count}.",
  "Archivo": "File",
  "Exigencia": "Requirement",
  "Obligatorio": "Required",
  "Opcional": "Optional",
  "Vigencia": "Validity",
  "Número de registro": "Registration number",
  "Sin número declarado": "No number declared",
  "Cargado": "Uploaded",
  "Revisado": "Reviewed",
  "Sin revisar": "Not reviewed",
  "Motivo del rechazo": "Reason for rejection",
  "Descargando…": "Downloading…",
  "Descargar archivo": "Download file",
  "La decisión queda auditada con su motivo. Revisar no otorga ni quita habilitación.":
    "The decision is audited with its reason. Reviewing neither grants nor removes access.",
  "Ya revisado: el backend solo acepta revisar documentos pendientes, así que no se ofrece cambiar la decisión.":
    "Already reviewed: the backend only accepts reviews of pending documents, so changing the decision isn't offered.",

  // ReferencesModerationPanel
  "Sin moderar": "Not moderated",
  "Moderadas": "Moderated",
  "Ocultar la referencia por moderación": "Hide the reference through moderation",
  "Ocultar referencia": "Hide reference",
  "La referencia deja de mostrarse en la ficha aunque el destinatario la tenga publicada. El texto no se modifica ni se borra. Autor y destinatario reciben un aviso y ven el motivo en sus referencias.":
    "The reference stops showing on the profile even if the recipient has published it. The text isn't changed or deleted. The author and the recipient get a notification and see the reason in their references.",
  "Restaurar la referencia": "Restore the reference",
  "Restaurar referencia": "Restore reference",
  "Se levanta la moderación y vuelve a valer la visibilidad que eligió el destinatario: si la tenía oculta, sigue oculta. Autor y destinatario reciben un aviso.":
    "Moderation is lifted and the visibility the recipient chose applies again: if they had hidden it, it stays hidden. The author and the recipient get a notification.",
  "Publicada por el destinatario": "Published by the recipient",
  "Oculta por el destinatario": "Hidden by the recipient",
  "La referencia de «{author}» sobre «{subject}» sigue sin moderación según la respuesta del backend.":
    "The reference from “{author}” about “{subject}” is still not moderated, according to the backend response.",
  "La referencia de «{author}» sobre «{subject}» quedó oculta por moderación.":
    "The reference from “{author}” about “{subject}” is now hidden by moderation.",
  "Ya estaba moderada: el backend no cambió nada y conserva el motivo vigente.":
    "It was already moderated: the backend changed nothing and keeps the current reason.",
  "La referencia de «{author}» sobre «{subject}» sigue moderada según la respuesta del backend.":
    "The reference from “{author}” about “{subject}” is still moderated, according to the backend response.",
  "La referencia de «{author}» sobre «{subject}» quedó sin moderación. {visibility}.":
    "The reference from “{author}” about “{subject}” is no longer moderated. {visibility}.",
  "No pudimos listar las referencias.": "We couldn't list the references.",
  "Ingresá el identificador público del perfil: 26 caracteres en mayúsculas y números (ULID), sin espacios.":
    "Enter the profile's public identifier: 26 uppercase letters and digits (ULID), with no spaces.",
  "No tenés permisos para moderar esta referencia. {detail}": "You don't have permission to moderate this reference. {detail}",
  "La referencia ya no existe. Actualizá el listado antes de insistir.": "The reference no longer exists. Refresh the list before trying again.",
  "No pudimos registrar la moderación.": "We couldn't record the moderation.",
  "Moderación de las referencias entre partes de un match aceptado. Ocultar o restaurar exige motivo, queda auditado y nunca modifica el texto. La moderación manda sobre la visibilidad que eligió el destinatario.":
    "Moderation of references between the parties of an accepted match. Hiding or restoring requires a reason, is audited and never changes the text. Moderation overrides the visibility the recipient chose.",
  "Filtros de referencias": "Reference filters",
  "Estado": "Status",
  "Perfil autor o destinatario (opcional)": "Author or recipient profile (optional)",
  "Identificador público (ULID) del perfil.": "The profile's public identifier (ULID).",
  "Consultando referencias…": "Loading references…",
  "No pudimos listar las referencias": "We couldn't list the references",
  "Ninguna referencia coincide con los filtros aplicados.": "No references match the applied filters.",
  "{count} referencias en esta página.": "References on this page: {count}.",
  "Estado consultado: {status} · perfil {profile}.": "Status queried: {status} · profile {profile}.",
  "Moderación: {state}": "Moderation: {state}",
  "Oculta por moderación": "Hidden by moderation",
  "Sin moderación": "Not moderated",
  "Visibilidad: {visibility}": "Visibility: {visibility}",
  "Autor": "Author",
  "Destinatario": "Recipient",
  "Creada": "Created",
  "Solicitud": "Request",
  "Motivo de moderación": "Moderation reason",
  "Sin motivo registrado": "No reason recorded",
  "Moderada": "Moderated",
  "Restaurar": "Restore",
  "Ocultar": "Hide",
  "La decisión queda auditada con su motivo. El texto de la referencia nunca se edita.":
    "The decision is audited with its reason. The reference text is never edited.",
  "Referencia de {author} sobre {subject}": "Reference from {author} about {subject}",

  // AuditLogsPanel
  "No pudimos consultar la auditoría.": "We couldn't load the audit log.",
  "Registro de solo lectura de las mutaciones administrativas. No hay acciones sobre los eventos: no se editan, no se borran y no se ocultan. Los actores y destinos se identifican con identificadores públicos, no con datos de contacto.":
    "Read-only record of admin changes. There are no actions on events: they aren't edited, deleted or hidden. Actors and targets are identified by public identifiers, not by contact details.",
  "Filtros de auditoría": "Audit filters",
  "Acción": "Action",
  "Coincidencia exacta con el nombre de la acción. Las sugerencias son las que el backend emite hoy; podés escribir otra.":
    "Exact match on the action name. The suggestions are the ones the backend emits today; you can type another.",
  "Tipo de destino": "Target type",
  "Todos los destinos": "All targets",
  "Desde": "From",
  "Hasta": "To",
  "Consultando la auditoría…": "Loading the audit log…",
  "No pudimos consultar la auditoría": "We couldn't load the audit log",
  "Ningún evento de auditoría coincide con los filtros aplicados.": "No audit events match the applied filters.",
  "{count} eventos en esta página.": "Events on this page: {count}.",
  "Fecha": "Date",
  "Destino": "Target",
  "Responsable (identificador público)": "Actor (public identifier)",
  "Motivo": "Reason",
  "Cambios registrados": "Recorded changes",

  // MetricsPanel
  "Sin fuente de datos todavía": "No data source yet",
  "No pudimos consultar las métricas.": "We couldn't load the metrics.",
  "Panel administrativo": "Admin dashboard",
  "Métricas agregadas de cuentas, perfiles y documentación. Los contadores reflejan lo que devuelve el backend: cuando una fuente de datos todavía no existe se informa como ausencia, nunca como cero.":
    "Aggregated metrics for accounts, profiles and documents. The counters reflect what the backend returns: when a data source doesn't exist yet it's reported as missing, never as zero.",
  "Rango de fechas": "Date range",
  "Aplicar rango": "Apply range",
  "Quitar rango": "Clear range",
  "Consultando métricas…": "Loading metrics…",
  "No pudimos consultar las métricas": "We couldn't load the metrics",
  "Cuentas activas": "Active accounts",
  "Cuentas que pueden operar en la plataforma.": "Accounts that can operate on the platform.",
  "Cuentas suspendidas": "Suspended accounts",
  "Solo conservan estado, soporte y cierre de sesión.": "They can only check their status, contact support and log out.",
  "Documentos pendientes": "Pending documents",
  "Cargas a la espera de revisión. Se revisan en la cola documental del backoffice.":
    "Uploads awaiting review. They're reviewed in the back office document queue.",
  "Solicitudes de contacto": "Contact requests",
  "El backend devolvió el mapa sin claves porque las solicitudes de contacto todavía no existen como fuente de datos. No hay ningún recuento que mostrar y esto no equivale a ausencia de solicitudes.":
    "The backend returned the map with no keys because contact requests don't exist as a data source yet. There's no count to show, and this doesn't mean there are no requests.",
  "Consultas de soporte sin responder": "Unanswered support enquiries",
  "El backend devolvió un valor nulo: la mesa de soporte todavía no persiste consultas, así que no puede afirmar ninguna cantidad. No es ausencia de consultas.":
    "The backend returned a null value: the support desk doesn't store enquiries yet, so it can't state any number. It doesn't mean there are no enquiries.",
  "Consultas recibidas que siguen sin respuesta.": "Enquiries received that are still unanswered.",
  "Perfiles por categoría": "Profiles by category",
  "Perfiles por estado de acceso": "Profiles by access state",
};
