import type { Dictionary } from "./types";

/** Búsqueda, ficha de directorio, solicitudes y referencias. */
export const APP_MATCH: Dictionary = {
  // SearchView
  "La búsqueda es para empresas turísticas": "Search is for tourism companies",
  "Los perfiles de {category} reciben solicitudes de contacto; las empresas turísticas son quienes buscan y las inician. Mantené tu perfil y tu disponibilidad al día para aparecer en sus resultados.":
    "Profiles in the {category} category receive contact requests; tourism companies are the ones who search and start them. Keep your profile and availability up to date to appear in their results.",
  "Ver mi disponibilidad": "View my availability",
  "Hubo cambios en el directorio: actualizamos los resultados y volvimos a la primera página con los mismos filtros.":
    "The directory changed: we refreshed the results and went back to the first page with the same filters.",
  "Resultados actualizados.": "Results updated.",
  "Los resultados cambiaron y la página siguiente ya no es válida. Volvimos a la primera página con los mismos filtros.":
    "The results changed and the next page is no longer valid. We went back to the first page with the same filters.",
  "Directorio de miembros": "Member directory",
  "Filtrá por categoría, ciudad y fechas. Con un rango, “Todos los días” exige cada fecha en la misma ciudad; “Al menos un día” muestra coincidencias parciales con su conteo.":
    "Filter by category, city and dates. With a range, “Every day” requires each date in the same city; “At least one day” shows partial matches with their count.",
  "Filtros de búsqueda": "Search filters",
  "Cargando ciudades…": "Loading cities…",
  "Todas las ciudades": "All cities",
  "Ciudad {id}": "City {id}",
  "No pudimos cargar el catálogo de ciudades.": "We couldn't load the list of cities.",
  "Todos los perfiles": "All profiles",
  "Solo verificados": "Verified only",
  "Sin verificación": "Not verified",
  "Coincidencia de fechas": "Date match",
  "Todos los días del rango": "Every day in the range",
  "Al menos un día del rango": "At least one day in the range",
  "El rango es inclusivo, de hasta 90 días. Para un solo día usá la misma fecha en ambos campos.":
    "The range is inclusive, up to 90 days. For a single day, use the same date in both fields.",
  "Buscar perfiles": "Search profiles",
  "Limpiar filtros": "Clear filters",
  "Sin conexión en tiempo real: actualizamos los resultados cada 30 segundos, así que los cambios pueden tardar en aparecer.":
    "No live connection: we refresh the results every 30 seconds, so changes may take a while to appear.",
  "Resultados": "Results",
  "Buscando perfiles…": "Searching profiles…",
  "No podés usar el buscador en este momento": "You can't use search right now",
  "Revisá los filtros": "Check the filters",
  "Hay filtros con valores que no podemos usar. El detalle está junto a cada campo.":
    "Some filters have values we can't use. Details are shown next to each field.",
  "No pudimos completar la búsqueda": "We couldn't complete the search",
  "No pudimos completar la búsqueda.": "We couldn't complete the search.",
  "Ningún perfil coincide con estos filtros": "No profiles match these filters",
  "Con “Todos los días del rango” cada fecha tiene que estar disponible en la misma ciudad. Probá con “Al menos un día del rango” para ver coincidencias parciales.":
    "With “Every day in the range”, each date must be available in the same city. Try “At least one day in the range” to see partial matches.",
  "Ver coincidencias parciales": "Show partial matches",
  "Probá quitar algún filtro o ampliar el rango de fechas.": "Try removing a filter or widening the date range.",
  "No pudimos cargar más resultados.": "We couldn't load more results.",
  "{count} perfil cargado · hay más resultados": "{count} profile loaded · more results available",
  "{count} perfil cargado": "{count} profile loaded",
  "{count} perfiles cargados · hay más resultados": "{count} profiles loaded · more results available",
  "{count} perfiles cargados": "{count} profiles loaded",
  "Ver ficha de {name}": "View {name}'s profile",
  "Ver ficha": "View profile",

  // directoryModel
  "Disponible el día buscado": "Available on the selected day",
  "Disponible los {count} días": "Available all {count} days",
  "Disponibilidad parcial: {matched} de {requested} día": "Partial availability: {matched} of {requested} day",
  "Disponibilidad parcial: {matched} de {requested} días": "Partial availability: {matched} of {requested} days",
  "Sin cargar": "Not added",
  "Este perfil todavía no tiene una habilitación vigente para usar el directorio.":
    "This profile doesn't have an active access grant to use the directory yet.",
  "La habilitación de este perfil venció. Tus datos se conservan, pero el directorio queda bloqueado mientras no se actualice la habilitación.":
    "This profile's access grant has expired. Your data is kept, but the directory stays locked until the access grant is renewed.",
  "Este perfil está suspendido y no puede consultar el directorio.":
    "This profile is suspended and can't access the directory.",
  "La cuenta está suspendida y no puede consultar el directorio.":
    "The account is suspended and can't access the directory.",

  // DirectoryProfileView
  "Volver a la búsqueda": "Back to search",
  "Sin conexión en tiempo real: actualizamos esta ficha cada 30 segundos, así que los cambios pueden tardar en aparecer.":
    "No live connection: we refresh this profile every 30 seconds, so changes may take a while to appear.",
  "Ficha de miembro": "Member profile",
  "Cargando ficha…": "Loading profile…",
  "Perfil no disponible": "Profile unavailable",
  "Este perfil no existe o no está visible en el directorio en este momento.":
    "This profile doesn't exist or isn't visible in the directory right now.",
  "No podés ver fichas en este momento": "You can't view profiles right now",
  "No pudimos cargar la ficha": "We couldn't load the profile",
  "No pudimos cargar la ficha.": "We couldn't load the profile.",
  "Ciudad principal: {city}": "Main city: {city}",
  "Sin ciudad principal": "No main city",
  "Cobertura y servicios": "Coverage and services",
  "Sin ciudades cargadas": "No cities added",
  "Sin idiomas cargados": "No languages added",
  "Sin servicios cargados": "No services added",
  "Documentación": "Documents",
  "No hay documentación requerida para esta categoría.": "No documents are required for this category.",
  "{status} · vigente hasta {date}": "{status} · valid until {date}",
  "Se muestra solo el estado de revisión; los archivos son privados.":
    "Only the review status is shown; the files are private.",
  "Todavía no tiene referencias visibles.": "No visible references yet.",
  "Las solicitudes de contacto las inician las empresas turísticas. El contacto se comparte solo después de un match aceptado.":
    "Contact requests are started by tourism companies. Contact details are only shared after an accepted match.",
  "Tu perfil no puede enviar solicitudes de contacto en este momento.":
    "Your profile can't send contact requests right now.",
  "Sin dato": "Not provided",
  "Sin razón social cargada": "No legal name added",
  "Formación": "Training",
  "Sin resumen de formación": "No training summary",
  "Licencia": "Licence",
  "Vehículo": "Vehicle",
  "Capacidad": "Capacity",
  "{count} pasajeros": "{count} passengers",
  "Flota": "Fleet",
  "Sin descripción de flota": "No fleet description",
  "Empresa y flota": "Company and fleet",
  "Datos de la categoría": "Category details",
  "Sin especialidades cargadas": "No specialities added",
  "Sin certificaciones cargadas.": "No certifications added.",
  "Certificaciones": "Certifications",
  "{institution} · {completed} · vence {expires}": "{institution} · {completed} · expires {expires}",
  "Sin vehículos cargados.": "No vehicles added.",
  "Vehículos de la flota": "Fleet vehicles",
  "{quantity} unidad · {capacity} plazas": "{quantity} unit · {capacity} seats",
  "{quantity} unidades · {capacity} plazas": "{quantity} units · {capacity} seats",
  "Calendario público": "Public calendar",
  "Disponibilidad publicada": "Published availability",
  "Mes anterior: {month}": "Previous month: {month}",
  "Mes siguiente: {month}": "Next month: {month}",
  "{count} día disponible en {month}.": "{count} day available in {month}.",
  "{count} días disponibles en {month}.": "{count} days available in {month}.",
  "Disponibilidad de {month}": "Availability for {month}",
  "Sin disponibilidad publicada": "No published availability",
  "{date}, hoy, disponible en {city}": "{date}, today, available in {city}",
  "{date}, disponible en {city}": "{date}, available in {city}",
  "{date}, hoy, sin disponibilidad publicada": "{date}, today, no published availability",
  "{date}, sin disponibilidad publicada": "{date}, no published availability",

  // ContactRequestForm
  "Alcanzaste el límite mensual de solicitudes": "You've reached your monthly request limit",
  "Tu habilitación permite {limit} solicitudes de contacto por mes y ya las usaste.":
    "Your access grant allows {limit} contact requests per month and you've used them all.",
  "Ya usaste las solicitudes de contacto disponibles para este mes.":
    "You've used all the contact requests available this month.",
  "Hasta que se renueve el cupo o cambie tu habilitación no podés enviar otra.":
    "You can't send another until your quota renews or your access grant changes.",
  "Ver mis solicitudes": "View my requests",
  "Solicitud enviada a {name}": "Request sent to {name}",
  "Ya habíamos registrado este envío: es la misma solicitud, no se duplicó ni se descontó otra vez del cupo.":
    "We had already recorded this submission: it's the same request, so it wasn't duplicated or counted against your quota again.",
  "Queda pendiente hasta que el perfil responda o hasta el {date} (hora de Argentina). Los datos de contacto se comparten solo si la acepta.":
    "It stays pending until the profile responds or until {date} (Argentina time). Contact details are only shared if they accept it.",
  "Describí el servicio que necesitás.": "Describe the service you need.",
  "Indicá las dos fechas del rango, o ninguna.": "Enter both dates of the range, or neither.",
  "Solicitar contacto": "Request contact",
  "Contale al perfil qué servicio necesitás. Si acepta, ambas partes ven los datos de contacto declarados; mientras tanto no se comparte ningún dato privado.":
    "Tell the profile what service you need. If they accept, both parties see the declared contact details; until then no private data is shared.",
  "Solicitud de contacto": "Contact request",
  "Servicio solicitado": "Requested service",
  "Obligatorio. Por ejemplo: actividad, cantidad de personas, idioma o requisitos.":
    "Required. For example: activity, group size, language or requirements.",
  "Desde (opcional)": "From (optional)",
  "Hasta (opcional)": "To (optional)",
  "Ciudad (opcional)": "City (optional)",
  "Sin ciudad indicada": "No city specified",
  "Fechas de a pares, desde hoy y hasta 90 días. Son contexto para el perfil: no reservan su calendario.":
    "Both dates or neither, from today up to 90 days ahead. They're context for the profile: they don't book their calendar.",
  "Enviar solicitud": "Send request",
  "Te queda {count} solicitud este mes.": "You have {count} request left this month.",
  "Te quedan {count} solicitudes este mes.": "You have {count} requests left this month.",

  // RequestsView
  "Seguimiento de las solicitudes que enviaste. Los datos de contacto se comparten solo cuando el perfil acepta.":
    "Track the requests you've sent. Contact details are only shared when the profile accepts.",
  "Solicitudes que te enviaron empresas turísticas. Aceptar habilita el contacto, pero no reserva tu calendario ni confirma una contratación.":
    "Requests sent to you by tourism companies. Accepting enables contact, but doesn't book your calendar or confirm a hire.",
  "Bandejas de solicitudes": "Request inboxes",
  "Solicitudes enviadas": "Sent requests",
  "Solicitudes recibidas": "Received requests",
  "Cargando solicitudes…": "Loading requests…",
  "No podés ver las solicitudes en este momento": "You can't view requests right now",
  "No pudimos cargar las solicitudes": "We couldn't load the requests",
  "No pudimos cargar las solicitudes.": "We couldn't load the requests.",
  "No hay solicitudes enviadas con estado “{status}”": "No sent requests with status “{status}”",
  "Todavía no hay solicitudes enviadas": "No sent requests yet",
  "No hay solicitudes recibidas con estado “{status}”": "No received requests with status “{status}”",
  "Todavía no hay solicitudes recibidas": "No received requests yet",
  "Buscá un perfil en el directorio y enviale una solicitud desde su ficha.":
    "Find a profile in the directory and send them a request from their profile page.",
  "Cuando una empresa turística te envíe una solicitud, aparece acá.":
    "When a tourism company sends you a request, it will appear here.",
  "{count} solicitud cargada · hay más": "{count} request loaded · more available",
  "{count} solicitud cargada": "{count} request loaded",
  "{count} solicitudes cargadas · hay más": "{count} requests loaded · more available",
  "{count} solicitudes cargadas": "{count} requests loaded",
  "No pudimos cargar más solicitudes.": "We couldn't load more requests.",
  "Recibida": "Received",
  "Vence el {date} (hora de Argentina)": "Expires on {date} (Argentina time)",
  "Ver solicitud a {name}": "View request to {name}",
  "Ver solicitud de {name}": "View request from {name}",
  "Ver detalle": "View details",

  // RequestDetailView
  "Listo: la solicitud quedó aceptada. Ya pueden ver los datos de contacto declarados. Recordá que esto no reserva el calendario ni confirma una contratación.":
    "Done: the request is accepted. You can both see the declared contact details now. Remember this doesn't book the calendar or confirm a hire.",
  "Listo: la solicitud quedó {status}.": "Done: the request is now {status}.",
  "¿Aceptar la solicitud?": "Accept the request?",
  "Aceptar solicitud": "Accept request",
  "Al aceptar, ambas partes van a poder ver los datos de contacto declarados en sus perfiles. Aceptar no reserva tu calendario ni confirma una contratación: los detalles se acuerdan directamente.":
    "Once you accept, both parties will be able to see the contact details declared on their profiles. Accepting doesn't book your calendar or confirm a hire: details are agreed directly.",
  "¿Rechazar la solicitud?": "Decline the request?",
  "Rechazar solicitud": "Decline request",
  "La empresa va a ver la solicitud como rechazada. No se comparte ningún dato de contacto y la decisión no se puede deshacer.":
    "The company will see the request as declined. No contact details are shared and the decision can't be undone.",
  "¿Cancelar la solicitud?": "Cancel the request?",
  "Cancelar solicitud": "Cancel request",
  "El perfil ya no va a poder responderla y no se comparte ningún dato de contacto. Para volver a enviarle una solicitud puede haber un tiempo de espera.":
    "The profile will no longer be able to respond and no contact details are shared. There may be a waiting period before you can send them another request.",
  "Volver a solicitudes": "Back to requests",
  "Cargando solicitud…": "Loading request…",
  "Solicitud no disponible": "Request unavailable",
  "Esta solicitud no existe o no pertenece al perfil activo.":
    "This request doesn't exist or doesn't belong to the active profile.",
  "No podés ver esta solicitud en este momento": "You can't view this request right now",
  "No pudimos cargar la solicitud": "We couldn't load the request",
  "No pudimos cargar la solicitud.": "We couldn't load the request.",
  "Solicitud a {name}": "Request to {name}",
  "Solicitud de {name}": "Request from {name}",
  "Solicitud enviada": "Request sent",
  "Solicitud recibida": "Request received",
  "No pudimos actualizar el detalle con la información más reciente. Lo que ves es lo último que respondió el servidor.":
    "We couldn't refresh the details with the latest information. What you see is the server's last response.",
  "Actualizar detalle": "Refresh details",
  "Fechas pedidas": "Requested dates",
  "Ciudad pedida": "Requested city",
  "Es un dato informativo: no es una reserva.": "This is for information only: it isn't a booking.",
  "Estado de la solicitud": "Request status",
  "La solicitud fue aceptada. Aceptar habilita el contacto, pero no reserva el calendario ni confirma una contratación.":
    "The request was accepted. Accepting enables contact, but doesn't book the calendar or confirm a hire.",
  "La solicitud está {status} y ya no admite cambios. No se comparten datos de contacto.":
    "The request is {status} and can no longer be changed. No contact details are shared.",
  "Vence el {date} (hora de Argentina). Después ya no puede aceptarse.":
    "Expires on {date} (Argentina time). After that it can no longer be accepted.",
  "Esperando respuesta": "Awaiting response",
  "Tu respuesta": "Your response",
  "Aceptar habilita que ambas partes vean los datos de contacto declarados. No reserva tu calendario ni confirma una contratación.":
    "Accepting lets both parties see the declared contact details. It doesn't book your calendar or confirm a hire.",
  "Con el estado de acceso actual no podés aceptar solicitudes, pero sí rechazarlas.":
    "With your current access status you can't accept requests, but you can decline them.",
  "Con el estado de acceso actual no podés aceptar solicitudes.":
    "With your current access status you can't accept requests.",
  "Aceptar": "Accept",
  "Rechazar": "Decline",
  "Perfil solicitado": "Requested profile",
  "Empresa solicitante": "Requesting company",
  "Ver ficha completa": "View full profile",
  "Es la ficha segura del perfil: no incluye datos de contacto.":
    "This is the profile's safe view: it doesn't include contact details.",
  "Enviada": "Sent",
  "Venció": "Expired",
  "Vence": "Expires",
  "Historial": "History",
  "Datos de contacto": "Contact details",
  "Se muestran solo cuando los pedís y no se guardan: al salir de esta pantalla se descartan. Tener el contacto no reserva el calendario ni confirma una contratación.":
    "They're only shown when you ask for them and aren't stored: they're discarded when you leave this screen. Having the contact details doesn't book the calendar or confirm a hire.",
  "Tus datos declarados": "Your declared details",
  "Ocultar datos de contacto": "Hide contact details",
  "Ver datos de contacto": "Show contact details",
  "No declarado": "Not declared",

  // requestsModel
  "{date} a las {time}": "{date} at {time}",
  "Sin fechas indicadas": "No dates specified",
  "{from} al {to}": "{from} to {to}",
  "Al enviarse, el perfil tenía disponibilidad publicada para todas las fechas pedidas.":
    "When it was sent, the profile had published availability for all the requested dates.",
  "Al enviarse, el perfil no tenía disponibilidad publicada para todas las fechas pedidas.":
    "When it was sent, the profile didn't have published availability for all the requested dates.",
  "La disponibilidad publicada cambió después del envío.": "The published availability changed after it was sent.",
  "La solicitud no indica fechas, así que no se comparó con el calendario.":
    "The request has no dates, so it wasn't checked against the calendar.",
  "Usaste {used} solicitudes en el mes iniciado el {month}, sin límite definido.":
    "You've used {used} requests in the month starting {month}, with no set limit.",
  "Usaste {used} de {limit} solicitudes de contacto del mes iniciado el {month}.":
    "You've used {used} of {limit} contact requests in the month starting {month}.",
  "Tu perfil todavía no tiene una habilitación vigente para esta acción.":
    "Your profile doesn't have an active access grant for this action yet.",
  "La habilitación de tu perfil venció. Tus datos y tu historial se conservan, pero esta acción queda bloqueada hasta que se actualice.":
    "Your profile's access grant has expired. Your data and history are kept, but this action is locked until it's renewed.",
  "Tu perfil está suspendido y no puede realizar esta acción.":
    "Your profile is suspended and can't perform this action.",
  "No pudimos confirmar el envío por un problema de conexión. Podés reintentar: se usa el mismo intento, así que no se duplica la solicitud ni se descuenta otra vez del cupo.":
    "We couldn't confirm it was sent due to a connection problem. You can try again: the same attempt is reused, so the request isn't duplicated or counted against your quota again.",
  "Tu categoría de perfil no envía solicitudes de contacto: las inician las empresas turísticas.":
    "Your profile category doesn't send contact requests: tourism companies start them.",
  "Alcanzaste el límite mensual de solicitudes de contacto de tu habilitación.":
    "You've reached your access grant's monthly contact request limit.",
  "Ya tenés una solicitud pendiente con este perfil. Esperá su respuesta o cancelala desde Solicitudes.":
    "You already have a pending request with this profile. Wait for their response or cancel it from Requests.",
  "Este perfil ya aceptó una solicitud tuya: el contacto está habilitado desde Solicitudes y no hace falta otra.":
    "This profile has already accepted one of your requests: contact is available from Requests, so you don't need another.",
  "Una solicitud reciente con este perfil terminó hace poco. Vas a poder enviar otra desde el {date} (hora de Argentina).":
    "A recent request with this profile ended a short while ago. You'll be able to send another from {date} (Argentina time).",
  "Una solicitud reciente con este perfil terminó hace poco. Todavía no podés enviar otra.":
    "A recent request with this profile ended a short while ago. You can't send another yet.",
  "Este intento de envío ya se había usado con otros datos. Revisá el formulario y enviá de nuevo: se generará un intento nuevo.":
    "This submission attempt was already used with different details. Check the form and send it again: a new attempt will be created.",
  "No tenés permiso para enviar esta solicitud desde el perfil activo.":
    "You don't have permission to send this request from the active profile.",
  "Este perfil ya no está disponible para recibir solicitudes.":
    "This profile is no longer available to receive requests.",
  "No pudimos confirmar la acción por un problema de conexión. Revisá el estado de la solicitud antes de reintentar.":
    "We couldn't confirm the action due to a connection problem. Check the request status before trying again.",
  "La solicitud ya no está pendiente: otra acción o su vencimiento cambiaron el estado mientras la mirabas. Actualizamos el detalle con el estado vigente.":
    "The request is no longer pending: another action or its expiry changed the status while you were viewing it. We've updated the details with the current status.",
  "La otra parte no puede concretar el contacto en este momento, así que la solicitud no se pudo aceptar.":
    "The other party can't make contact right now, so the request couldn't be accepted.",
  "Tu perfil no puede realizar esta acción sobre la solicitud.":
    "Your profile can't perform this action on the request.",
  "No pudimos completar la acción.": "We couldn't complete the action.",
  "No pudimos obtener los datos de contacto por un problema de conexión. Podés reintentar.":
    "We couldn't get the contact details due to a connection problem. You can try again.",
  "Los datos de contacto no están disponibles en este momento porque la otra parte no puede concretar el contacto. Probá más adelante.":
    "Contact details aren't available right now because the other party can't make contact. Try again later.",
  "{message} Mientras tanto no se muestran datos de contacto.":
    "{message} Contact details aren't shown in the meantime.",
  "La solicitud no está aceptada, así que no hay datos de contacto para mostrar.":
    "The request isn't accepted, so there are no contact details to show.",
  "Tu perfil no puede ver los datos de contacto de esta solicitud.":
    "Your profile can't view the contact details for this request.",
  "No pudimos obtener los datos de contacto.": "We couldn't get the contact details.",

  // RequestReferencePanel
  "Revisando si ya dejaste una referencia en este match…":
    "Checking whether you've already left a reference for this match…",
  "Referencia guardada sobre {name}": "Reference saved about {name}",
  "Ya dejaste una referencia sobre {name}": "You've already left a reference about {name}",
  "Escrita el {date}. No se puede editar: {name} decide si la publica en su ficha.":
    "Written on {date}. It can't be edited: {name} decides whether to publish it on their profile.",
  "Ver tus referencias": "View your references",
  "Ya dejaste una referencia en este match. Cada parte puede dejar una sola y no se edita.":
    "You've already left a reference for this match. Each party can leave only one and it can't be edited.",
  "Con el estado de acceso actual no podés dejar referencias.":
    "With your current access status you can't leave references.",
  "Las referencias que ya escribiste siguen disponibles en Referencias.":
    "The references you've already written are still available in References.",
  "Contá cómo fue trabajar con {name}. Es texto libre. La referencia empieza oculta: {name} decide si la publica en su ficha. Una vez enviada no se puede editar.":
    "Describe what it was like to work with {name}. It's free text. The reference starts hidden: {name} decides whether to publish it on their profile. Once sent it can't be edited.",
  "Dejá una referencia sobre {name}": "Leave a reference about {name}",
  "Entre {min} y {max} caracteres. Se respetan los saltos de línea.":
    "Between {min} and {max} characters. Line breaks are kept.",
  "Enviar referencia": "Send reference",

  // ReferencesView
  "Referencias profesionales": "Professional references",
  "Las referencias son textos libres que dejan las partes de un match aceptado. Un match aceptado no equivale a una contratación ni a un servicio realizado. Las que recibís empiezan ocultas: vos decidís cuáles se publican en tu ficha.":
    "References are free-text notes left by the parties of an accepted match. An accepted match doesn't mean a hire or a completed service. The ones you receive start hidden: you decide which are published on your profile.",
  "Referencias por dirección": "References by direction",
  "Referencias recibidas": "References received",
  "Referencias escritas por vos": "References you wrote",
  "Cargando referencias…": "Loading references…",
  "No podés ver las referencias en este momento": "You can't view references right now",
  "No pudimos cargar las referencias": "We couldn't load the references",
  "No pudimos cargar las referencias.": "We couldn't load the references.",
  "Todavía no recibiste referencias": "You haven't received any references yet",
  "Cuando la otra parte de un match aceptado deje una referencia sobre tu perfil, aparece acá oculta hasta que decidas publicarla.":
    "When the other party of an accepted match leaves a reference about your profile, it appears here hidden until you decide to publish it.",
  "Todavía no escribiste referencias": "You haven't written any references yet",
  "Podés dejar una desde el detalle de una solicitud aceptada.":
    "You can leave one from the details of an accepted request.",
  "Ver solicitudes": "View requests",
  "{count} referencia cargada · hay más": "{count} reference loaded · more available",
  "{count} referencia cargada": "{count} reference loaded",
  "{count} referencias cargadas · hay más": "{count} references loaded · more available",
  "{count} referencias cargadas": "{count} references loaded",
  "No pudimos cargar más referencias.": "We couldn't load more references.",
  "Escrita por": "Written by",
  "Sobre": "About",
  "Estado: {status}": "Status: {status}",
  "Ocultar de mi ficha": "Hide from my profile",
  "Publicar en mi ficha": "Publish on my profile",
  "Ver la solicitud relacionada con {name}": "View the related request with {name}",

  // referencesModel
  "Escritas por vos": "Written by you",
  "Publicada en tu ficha": "Published on your profile",
  "Oculta en tu ficha": "Hidden on your profile",
  "Publicada por {name}": "Published by {name}",
  "Pendiente de publicación por {name}": "Awaiting publication by {name}",
  "Motivo de moderación: {reason}": "Moderation reason: {reason}",
  "Administración no registró un motivo visible.": "The administrators didn't record a visible reason.",
  "Escribí al menos {min} caracteres (sin contar espacios al principio o al final).":
    "Write at least {min} characters (not counting leading or trailing spaces).",
  "Usá como máximo {max} caracteres.": "Use {max} characters at most.",
  "{length} de {max} caracteres (mínimo {min}).": "{length} of {max} characters (minimum {min}).",
  "No pudimos confirmar el envío por un problema de conexión. Revisá en Referencias si quedó registrada antes de reintentar.":
    "We couldn't confirm it was sent due to a connection problem. Check References to see if it was saved before trying again.",
  "La solicitud ya no está aceptada, así que no admite referencias. Actualizamos el detalle con su estado vigente.":
    "The request is no longer accepted, so it doesn't allow references. We've updated the details with its current status.",
  "Revisá el texto de la referencia.": "Check the reference text.",
  "Tu perfil no puede dejar una referencia en esta solicitud.":
    "Your profile can't leave a reference on this request.",
  "La solicitud ya no está disponible para este perfil.": "The request is no longer available to this profile.",
  "No pudimos guardar la referencia.": "We couldn't save the reference.",
  "No pudimos guardar el cambio por un problema de conexión. La referencia quedó como estaba.":
    "We couldn't save the change due to a connection problem. The reference is unchanged.",
  "Administración ocultó esta referencia por moderación mientras la mirabas, así que no podés cambiar su visibilidad. Actualizamos el listado.":
    "The administrators hid this reference for moderation while you were viewing it, so you can't change its visibility. We've updated the list.",
  "Solo quien recibió la referencia decide si se publica en su ficha.":
    "Only the person who received the reference decides whether it's published on their profile.",
  "La referencia ya no está disponible para este perfil.": "The reference is no longer available to this profile.",
  "No pudimos guardar el cambio.": "We couldn't save the change.",
};
