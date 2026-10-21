import type { Dictionary } from "./types";

/**
 * Landing pública, modal de acceso y formulario de contacto. Los títulos con "\n" marcan
 * los saltos de línea del diseño: la traducción conserva la misma cantidad de líneas.
 * Ya están en `common.ts` (no se repiten): "Empresa turística", "Guía", "Conductor",
 * "Instructor" e "Idioma".
 */
export const LANDING: Dictionary = {
  // Perfiles (hero y sección de perfiles)
  "Guía profesional": "Professional guide",
  "Conductor profesional": "Professional driver",
  "Instructor especializado": "Specialist instructor",
  "Transporte de pasajeros": "Passenger transport",
  "Logotipo · Imágenes · Propuestas · Habilitaciones · Datos de empresa":
    "Logo · Images · Offers · Certifications · Company details",
  "Formación · Servicios · Disponibilidad · Ciudades · Habilitaciones":
    "Training · Services · Availability · Cities · Certifications",
  "Licencia · Permisos · Disponibilidad · Ciudades de operación":
    "Licence · Permits · Availability · Operating cities",
  "Especialidad · Formación · Habilitaciones · Disponibilidad · Zona":
    "Speciality · Training · Certifications · Availability · Area",
  "Flota · Habilitaciones · Servicios · Disponibilidad · Cobertura":
    "Fleet · Certifications · Services · Availability · Coverage",

  // Características (Quiénes somos)
  "Disponibilidad declarada": "Declared availability",
  "Los perfiles receptores parten de fechas bloqueadas y publican únicamente los días y ciudades en que pueden recibir solicitudes.":
    "Receiving profiles start with every date blocked and publish only the days and cities when they can take requests.",
  "Búsqueda precisa": "Precise search",
  "La empresa turística filtra por perfil, ubicación, habilitaciones y rango de fechas para encontrar coincidencias relevantes.":
    "Tourism companies filter by profile, location, certifications and date range to find relevant matches.",
  "Solicitudes protegidas": "Protected requests",
  "Los datos de contacto no se exponen en el directorio. Primero se envía una solicitud y la contraparte decide si la acepta.":
    "Contact details aren't shown in the directory. A request is sent first and the other party decides whether to accept it.",
  "Verificación documental": "Document verification",
  "La verificación depende de documentos aprobados y vigentes. Una carga pendiente nunca se presenta como verificada.":
    "Verification depends on approved, valid documents. A pending upload is never shown as verified.",
  "Cobertura por ciudad": "Coverage by city",
  "Cada perfil informa dónde opera y, cuando corresponde, asocia una ciudad a cada día publicado.":
    "Each profile states where it operates and, where relevant, links a city to each published day.",
  "Acceso habilitado": "Granted access",
  "Las capacidades se conceden manualmente por perfil y se muestran separadas del estado de verificación.":
    "Capabilities are granted manually per profile and shown separately from the verification status.",

  // Preguntas frecuentes
  "¿Contactur es para turistas?": "Is Contactur for tourists?",
  "No. Contactur está pensado para empresas y profesionales del sector turístico. No es un portal de viajes para público general.":
    "No. Contactur is designed for companies and professionals in the tourism sector. It isn't a travel portal for the general public.",
  "¿Quién puede iniciar una solicitud?": "Who can start a request?",
  "Solo una empresa turística con acceso habilitado puede iniciar una solicitud hacia un perfil receptor. Aceptarla habilita la consulta de los datos declarados, pero no confirma una contratación ni reserva fechas.":
    "Only a tourism company with granted access can send a request to a receiving profile. Accepting it unlocks the declared details, but it doesn't confirm a hire or reserve dates.",
  "¿Cómo funciona la disponibilidad?": "How does availability work?",
  "Guías, conductores, instructores y transportes parten de fechas bloqueadas y publican manualmente días futuros por ciudad. Las empresas turísticas buscan disponibilidad, pero no tienen calendario propio.":
    "Guides, drivers, instructors and transport companies start with every date blocked and manually publish future days by city. Tourism companies search availability but don't have a calendar of their own.",
  "¿Acceso activo significa perfil verificado?": "Does active access mean a verified profile?",
  "No. Son estados independientes. El acceso define capacidades de uso; la verificación exige que la documentación requerida esté aprobada y vigente.":
    "No. They're separate statuses. Access defines what you can use; verification requires the required documents to be approved and valid.",
  "¿Puedo administrar más de un perfil?": "Can I manage more than one profile?",
  "Sí. Una cuenta puede tener perfiles independientes para actividades distintas. Cada perfil conserva su categoría, acceso, solicitudes y notificaciones.":
    "Yes. One account can hold separate profiles for different activities. Each profile keeps its own category, access, requests and notifications.",
  "¿Cómo se habilita un perfil nuevo?": "How does a new profile get access?",
  "Después de completar datos, documentos, revisión y términos, el perfil queda pendiente. La habilitación es manual y no se activa de forma automática.":
    "Once the details, documents, review and terms are complete, the profile stays pending. Access is granted manually and never switches on automatically.",

  // Resultados y etiquetas de las demostraciones
  "Ushuaia · Naturaleza · documentación vigente": "Ushuaia · Nature · valid documents",
  "Río Grande · Senderismo · documentación vigente": "Río Grande · Hiking · valid documents",
  "Ushuaia · Licencia habilitante vigente": "Ushuaia · Valid professional licence",
  "Naturaleza": "Nature",
  "Senderismo": "Hiking",
  "Interpretación ambiental": "Environmental interpretation",
  "Grupos reducidos": "Small groups",

  // Header
  "Cerrar navegación": "Close navigation",
  "Abrir navegación": "Open navigation",
  "Navegación principal": "Main navigation",
  "Quiénes somos": "About us",
  "Perfiles": "Profiles",
  "Cómo funciona": "How it works",
  "Acceso": "Access",
  "FAQ": "FAQ",
  "Contacto": "Contact",
  "Iniciar sesión": "Log in",
  "Crear perfil": "Create profile",

  // Hero
  "Conectá con\nprofesionales\ndel turismo": "Connect with\nprofessionals\nin tourism",
  "Plataforma B2B · Turismo profesional": "B2B platform · Professional tourism",
  "Una herramienta para coordinar disponibilidad y solicitudes entre empresas, guías, conductores, instructores y transportes del sector turístico.":
    "A tool to coordinate availability and requests between companies, guides, drivers, instructors and transport providers in the tourism sector.",
  "Crear mi perfil →": "Create my profile →",
  "Ver cómo funciona": "See how it works",
  "Perfiles de demostración": "Demo profiles",
  "Demostración": "Demo",
  "Inicia búsquedas y solicitudes": "Starts searches and requests",
  "Perfil receptor de ejemplo": "Sample receiving profile",
  "En revisión": "Under review",
  "Acceso activo": "Active access",

  // Stats
  "Tipos de perfil": "Profile types",
  "Red profesional": "Professional network",
  "Interfaz actual": "Current interface",
  "Manual": "Manual",
  "Habilitación de acceso": "Access grant",
  "Características de Contactur": "Contactur at a glance",

  // About
  "Una herramienta para\nel turismo profesional": "A tool for\nprofessional tourism",
  "Contactur no es una bolsa de trabajo ni un portal de viajes. Es un espacio para que actores del sector encuentren perfiles, coordinen disponibilidad y gestionen solicitudes con reglas claras.":
    "Contactur isn't a job board or a travel portal. It's a space where people in the sector find profiles, coordinate availability and manage requests under clear rules.",

  // Profiles
  "Perfiles disponibles": "Available profiles",
  "Cinco perfiles,\nuna plataforma": "Five profiles,\none platform",
  "Cada categoría muestra herramientas acordes a su actividad. La empresa turística inicia búsquedas; los otros perfiles publican disponibilidad.":
    "Each category shows tools suited to its activity. Tourism companies start searches; the other profiles publish availability.",

  // AvailabilityDemo
  "{day} de abril de 2027, día de referencia. Demostración": "{day} April 2027, reference day. Demo",
  "{day} de abril de 2027, disponible. Demostración": "{day} April 2027, available. Demo",
  "{day} de abril de 2027, bloqueado. Demostración": "{day} April 2027, blocked. Demo",
  "Demostración · disponibilidad": "Demo · availability",
  "Fechas bloqueadas\npor defecto": "Dates blocked\nby default",
  "Un perfil receptor habilita días futuros y la empresa turística consulta coincidencias. Esta interacción usa datos ficticios y no guarda cambios.":
    "A receiving profile opens up future days and the tourism company looks for matches. This interaction uses fictional data and doesn't save changes.",
  "Perfil guía — Demostración": "Guide profile — Demo",
  "Abril de 2027 · datos ficticios": "April 2027 · fictional data",
  "Demo": "Demo",
  "Bloqueado": "Blocked",
  "Disponible": "Available",
  "Referencia demo": "Demo reference",
  "Mes anterior, demostración": "Previous month, demo",
  "Abril 2027 · Demostración": "April 2027 · Demo",
  "Mes siguiente, demostración": "Next month, demo",
  "Interacción de demostración: los cambios son locales y no publican disponibilidad real.":
    "Demo interaction: changes stay on this page and don't publish real availability.",
  "Empresa turística — Búsqueda": "Tourism company — Search",
  "Demostración con perfiles ficticios": "Demo with fictional profiles",
  "Tipo de perfil": "Profile type",
  "Ciudad o destino": "City or destination",
  "Desde · demo": "From · demo",
  "12 abr 2027": "12 Apr 2027",
  "Hasta · demo": "To · demo",
  "18 abr 2027": "18 Apr 2027",
  "Buscar en la demostración →": "Search the demo →",
  "Demostración local: los filtros se aplicaron sobre datos ficticios.":
    "Local demo: the filters were applied to fictional data.",
  "3 resultados ficticios · Demostración": "3 fictional results · Demo",
  "Disponibilidad ficticia de {name}": "Fictional availability for {name}",

  // DashboardDemo
  "Ushuaia · Naturaleza": "Ushuaia · Nature",
  "Río Grande · Senderismo": "Río Grande · Hiking",
  "Ushuaia · Traslados turísticos": "Ushuaia · Tourist transfers",
  "Demostración · panel": "Demo · dashboard",
  "Tu espacio de trabajo": "Your workspace",
  "Vista conceptual del panel de una empresa turística. Todos los nombres, resultados y valores son ficticios.":
    "A concept view of a tourism company's dashboard. All names, results and figures are fictional.",
  "DEMOSTRACIÓN": "DEMO",
  "Navegación del panel de demostración": "Demo dashboard navigation",
  "Empresa · Acceso activo": "Company · Active access",
  "Búsqueda": "Search",
  "Solicitudes": "Requests",
  "Perfil": "Profile",
  "Referencias": "References",
  "Ajustes": "Settings",
  "Búsqueda de profesionales": "Find professionals",
  "Datos ficticios · Demostración": "Fictional data · Demo",
  "Guías en Ushuaia…": "Guides in Ushuaia…",
  "Indicadores ficticios de demostración": "Fictional demo indicators",
  "Resultados demo": "Demo results",
  "Datos ficticios": "Fictional data",
  "Coincidencias demo": "Demo matches",
  "Solicitudes demo": "Demo requests",
  "Coincidencia disponible en la demostración": "Available match in the demo",
  "{location} · Perfil ficticio": "{location} · Fictional profile",
  "Ver ficha demo": "View demo profile",
  "Responsive y accesible:": "Responsive and accessible:",
  "el panel reorganiza su contenido para mantener lectura, foco y acciones táctiles en pantallas pequeñas.":
    "the dashboard rearranges its content to keep reading, focus and touch actions usable on small screens.",

  // MiniCalendar y ProfileDemo
  "Calendario ficticio de abril de 2027": "Fictional calendar for April 2027",
  "Demostración · ficha": "Demo · profile page",
  "Información útil,\nestados claros": "Useful information,\nclear statuses",
  "Ejemplo ficticio de la información que un miembro habilitado podría consultar. No contiene datos personales reales.":
    "A fictional example of the information an authorised member could view. It contains no real personal data.",
  "Guía profesional · Demo": "Professional guide · Demo",
  "Ubicación": "Location",
  "Opera en": "Operates in",
  "Verificación": "Verification",
  "Verificado": "Verified",
  "Español": "Spanish",
  "Enviar solicitud de contacto": "Send contact request",
  "Acción ilustrativa: requiere empresa habilitada y no se envía desde esta landing.":
    "Illustrative action: it requires an authorised company and isn't sent from this page.",
  "Descripción profesional · Demostración": "Professional description · Demo",
  "Perfil ficticio especializado en interpretación ambiental y recorridos de naturaleza en Tierra del Fuego. El texto ilustra la estructura de una ficha, no acredita servicios realizados.":
    "A fictional profile specialising in environmental interpretation and nature tours in Tierra del Fuego. The text shows how a profile page is structured; it doesn't certify any services provided.",
  "Servicios declarados · Demostración": "Declared services · Demo",
  "Formación y documentos · Demostración": "Training and documents · Demo",
  "Documento aprobado y vigente": "Approved, valid document",
  "Formación declarada": "Declared training",
  "Disponibilidad · Abril 2027 · Demostración": "Availability · April 2027 · Demo",
  "Azul: disponible · Gris: bloqueado · Datos ficticios.": "Blue: available · Grey: blocked · Fictional data.",

  // Onboarding
  "Elegí una categoría": "Choose a category",
  "Definí la actividad del perfil para mostrar los campos correspondientes.":
    "Set the profile's activity to show the relevant fields.",
  "Transporte": "Transport",
  "Completá datos y cuenta": "Complete details and account",
  "Cargá identidad, credenciales, actividad, ubicación y datos declarados.":
    "Enter identity, credentials, activity, location and declared details.",
  "Datos personales o de empresa": "Personal or company details",
  "Email y contraseña": "Email and password",
  "Servicios y ciudades": "Services and cities",
  "Foto o logotipo": "Photo or logo",
  "Cargá documentación": "Upload documents",
  "Adjuntá los documentos requeridos para que puedan revisarse.":
    "Attach the required documents so they can be reviewed.",
  "Archivos por categoría": "Files by category",
  "Estado inicial pendiente": "Initial status: pending",
  "Revisión administrativa": "Administrative review",
  "Motivo ante rechazo": "Reason if rejected",
  "Revisión y términos": "Review and terms",
  "Revisá la información y aceptá los términos versionados antes de enviar.":
    "Review the information and accept the versioned terms before submitting.",
  "Confirmación de datos": "Details confirmation",
  "Aceptación registrada": "Recorded acceptance",
  "Envío a revisión": "Submission for review",
  "Habilitación manual pendiente": "Manual access grant pending",
  "Proceso de alta": "Sign-up process",
  "Cuatro pasos y\nrevisión responsable": "Four steps and\na careful review",
  "El alta es guiada. Al finalizar, el perfil queda pendiente de revisión y habilitación manual; completar el formulario no activa capacidades.":
    "Sign-up is guided. When you finish, the profile awaits review and a manual access grant; completing the form doesn't activate any capabilities.",
  "El flujo transaccional se integrará con el BFF en una etapa posterior.":
    "The transactional flow will be connected to the BFF at a later stage.",
  "Consultar alta de perfil": "Ask about profile sign-up",

  // AccessCards
  "Acceso inicial": "Starter access",
  "Capacidades orientativas para comenzar con un perfil profesional.":
    "Indicative capabilities to get started with a professional profile.",
  "Ficha visible a miembros habilitados": "Profile visible to authorised members",
  "Búsqueda según categoría": "Search by category",
  "Solicitudes con límite configurable": "Requests with a configurable limit",
  "Una ciudad orientativa": "One indicative city",
  "Acceso ampliado": "Extended access",
  "Capacidades orientativas para perfiles con mayor cobertura operativa.":
    "Indicative capabilities for profiles with wider operating coverage.",
  "Más ciudades configurables": "More configurable cities",
  "Galería cuando esté habilitada": "Gallery when enabled",
  "Límite de solicitudes configurable": "Configurable request limit",
  "Estado de acceso independiente": "Separate access status",
  "Acceso organización": "Organisation access",
  "Capacidades orientativas para empresas turísticas con más destinos.":
    "Indicative capabilities for tourism companies with more destinations.",
  "Identidad visual del perfil": "Profile visual identity",
  "Cobertura configurable": "Configurable coverage",
  "Búsqueda y solicitudes": "Search and requests",
  "Soporte sobre habilitación": "Support with access grants",
  "Capacidades según\ncada necesidad": "Capabilities for\nevery need",
  "Estas tarjetas son informativas. Las capacidades definitivas se configuran por perfil y la habilitación siempre es manual.":
    "These cards are for information only. Final capabilities are configured per profile and access is always granted manually.",
  "Orientativo": "Indicative",
  "Consultar acceso": "Ask about access",

  // FAQ
  "Preguntas frecuentes": "Frequently asked questions",
  "Todo lo que necesitás saber": "Everything you need to know",

  // Contact
  "No pudimos enviar tu consulta. Intentá de nuevo en unos minutos.":
    "We couldn't send your enquiry. Try again in a few minutes.",
  "Hiciste demasiados envíos seguidos. Esperá 1 minuto y volvé a intentar.":
    "You've sent too many messages in a row. Wait 1 minute and try again.",
  "Hiciste demasiados envíos seguidos. Esperá {minutes} minutos y volvé a intentar.":
    "You've sent too many messages in a row. Wait {minutes} minutes and try again.",
  "Hiciste demasiados envíos seguidos. Esperá unos minutos y volvé a intentar.":
    "You've sent too many messages in a row. Wait a few minutes and try again.",
  "Revisá los datos marcados en el formulario.": "Check the highlighted fields in the form.",
  "No pudimos procesar tu consulta. Revisá los datos e intentá de nuevo.":
    "We couldn't process your enquiry. Check the details and try again.",
  "¿Tenés alguna consulta?": "Have a question?",
  "Escribinos sobre acceso, alta de perfiles, privacidad o soporte general. Te respondemos por email a la dirección que indiques.":
    "Write to us about access, profile sign-up, privacy or general support. We'll reply by email to the address you give us.",
  "Respuesta por email": "Reply by email",
  "Nombre": "Name",
  "Tu nombre": "Your name",
  "Email": "Email",
  "tu@email.com": "you@email.com",
  "Categoría (opcional)": "Category (optional)",
  "Sin categoría": "No category",
  "Consulta de acceso": "Access enquiry",
  "Alta de perfil": "Profile sign-up",
  "Soporte general": "General support",
  "Privacidad o términos": "Privacy or terms",
  "Mensaje": "Message",
  "Contanos tu consulta": "Tell us what you need",
  "Enviando…": "Sending…",
  "Enviar consulta →": "Send enquiry →",
  "Recibimos tu consulta. Te vamos a responder por email.": "We've received your enquiry. We'll reply by email.",
  "Enviando tu consulta…": "Sending your enquiry…",

  // Footer
  "Coordinación profesional para el ecosistema turístico, con acceso y verificación como estados independientes.":
    "Professional coordination for the tourism ecosystem, with access and verification as separate statuses.",
  "Plataforma": "Platform",
  "Empresas": "Companies",
  "Guías": "Guides",
  "Conductores": "Drivers",
  "Instructores y transportes": "Instructors and transport",
  "Soporte": "Support",
  "Solicitar términos": "Request the terms",
  "Solicitar aviso de privacidad": "Request the privacy notice",
  // Describe el idioma activo de la interfaz, no se traduce literal.
  "Interfaz en español": "Interface in English",

  // AuthModal: títulos
  "Bienvenido": "Welcome",
  "Iniciá sesión con tu cuenta de Contactur.": "Log in with your Contactur account.",
  "Crear una cuenta": "Create an account",
  "El alta crea tu cuenta. No crea perfiles ni concede acceso automáticamente.":
    "Signing up creates your account. It doesn't create profiles or grant access automatically.",
  "Recuperar contraseña": "Recover your password",
  "Te enviaremos instrucciones si el email corresponde a una cuenta.":
    "We'll send you instructions if the email belongs to an account.",
  "Nueva contraseña": "New password",
  "Elegí una contraseña nueva para cerrar las sesiones anteriores.":
    "Choose a new password to log out of previous sessions.",
  "Verificar correo": "Verify email",
  "Estamos validando el enlace de verificación.": "We're checking the verification link.",

  // AuthModal: validación por campo (T23)
  "Ingresá tu nombre.": "Enter your name.",
  "El nombre debe tener al menos 2 caracteres.": "Your name must be at least 2 characters.",
  "Ingresá tu email.": "Enter your email.",
  "Ingresá un email válido, por ejemplo nombre@dominio.com.": "Enter a valid email, for example name@domain.com.",
  "Ingresá tu contraseña.": "Enter your password.",
  "Elegí una contraseña de al menos 12 caracteres.": "Choose a password of at least 12 characters.",
  "La contraseña debe tener al menos 12 caracteres.": "Your password must be at least 12 characters.",
  "Repetí la contraseña.": "Repeat the password.",
  "Las contraseñas no coinciden.": "The passwords don't match.",

  // AuthModal: verificación, envíos y estados
  "El enlace de verificación no es válido.": "The verification link isn't valid.",
  "Tu correo quedó verificado. Ya podés iniciar sesión.": "Your email is verified. You can now log in.",
  "No pudimos verificar el correo.": "We couldn't verify the email.",
  "No pudimos iniciar sesión. Revisá tus datos e intentá nuevamente.":
    "We couldn't log you in. Check your details and try again.",
  "No pudimos crear la cuenta. Revisá los datos.": "We couldn't create the account. Check your details.",
  "No pudimos crear la cuenta. Intentá nuevamente.": "We couldn't create the account. Try again.",
  "No pudimos enviar las instrucciones. Intentá nuevamente más tarde.":
    "We couldn't send the instructions. Try again later.",
  "No pudimos restablecer la contraseña.": "We couldn't reset the password.",
  "Contraseña actualizada. Las sesiones anteriores fueron cerradas.":
    "Password updated. Previous sessions have been logged out.",
  "Enviamos un nuevo correo de verificación.": "We've sent a new verification email.",
  "No pudimos reenviar el correo en este momento.": "We couldn't resend the email right now.",

  // AuthModal: formularios
  "Cerrar inicio de sesión": "Close login",
  "Contraseña": "Password",
  "Ingresando…": "Logging in…",
  "Iniciar sesión →": "Log in →",
  "¿Olvidaste tu contraseña?": "Forgot your password?",
  "o": "or",
  "Conocer el proceso de alta": "See how sign-up works",
  "Cuenta creada": "Account created",
  "Revisá tu correo para verificarla. El alta no creó un perfil ni concedió habilitación o capacidades.":
    "Check your email to verify it. Signing up didn't create a profile or grant access or capabilities.",
  "Reenviar verificación": "Resend verification",
  "Ir al inicio de sesión": "Go to login",
  "Al menos 12 caracteres.": "At least 12 characters.",
  "Confirmar contraseña": "Confirm password",
  "Creando cuenta…": "Creating account…",
  "Crear cuenta →": "Create account →",
  "Ya tengo una cuenta": "I already have an account",
  "Revisá tu correo": "Check your email",
  "Si el email corresponde a una cuenta, recibirás instrucciones para restablecer la contraseña.":
    "If the email belongs to an account, you'll receive instructions to reset your password.",
  "Volver al inicio de sesión": "Back to login",
  "Enviar instrucciones →": "Send instructions →",
  "Volver": "Back",
  "Guardar contraseña →": "Save password →",

  // LandingPage: aviso de cierre local
  "La sesión local se cerró. No pudimos confirmar la revocación remota.":
    "You were logged out on this device. We couldn't confirm the session was revoked on the server.",
};
