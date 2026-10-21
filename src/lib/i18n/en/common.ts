import type { Dictionary } from "./types";

/** Textos compartidos por varias áreas (selector de idioma, estados genéricos). */
export const COMMON: Dictionary = {
  "Idioma": "Language",
  "Cambiar el idioma a {language}": "Switch language to {language}",
  "Contactur | Turismo profesional": "Contactur | Professional tourism",
  "Plataforma B2B para coordinar disponibilidad y solicitudes entre profesionales del turismo.":
    "B2B platform to coordinate availability and contact requests between tourism professionals.",
  "Reintentar": "Try again",
  "Cerrar sesión": "Log out",
  "Cerrando…": "Logging out…",
  "Ir a Contactur": "Go to Contactur",
  "No pudimos enviar la solicitud.": "We couldn't send the request.",
  "hora de Argentina": "Argentina time",

  // Clientes de API (features/app/api.ts) y mensajes genéricos del BFF.
  "No pudimos obtener los datos solicitados.": "We couldn't load the requested data.",
  "La respuesta del servidor no tiene el formato esperado.": "The server response wasn't in the expected format.",
  "No pudimos guardar los cambios.": "We couldn't save your changes.",
  "No pudimos subir el archivo.": "We couldn't upload the file.",
  "No pudimos eliminar el recurso.": "We couldn't delete it.",
  "No pudimos descargar el documento.": "We couldn't download the document.",
  "La respuesta de descarga no tiene el formato esperado.": "The download response wasn't in the expected format.",
  "El servicio no está disponible temporalmente.": "The service is temporarily unavailable.",
  "El servicio devolvió una respuesta inválida.": "The service returned an invalid response.",
  "La solicitud no pudo completarse.": "The request couldn't be completed.",
  "No pudimos completar la solicitud.": "We couldn't complete the request.",
  "La ruta solicitada no está disponible.": "The requested route isn't available.",
  "No pudimos leer la solicitud.": "We couldn't read the request.",
  "La solicitud supera el tamaño permitido.": "The request is larger than allowed.",
  "El cuerpo de la solicitud no es JSON válido.": "The request body isn't valid JSON.",
  "Necesitás iniciar sesión.": "You need to log in.",
  "No pudimos validar el origen de la solicitud.": "We couldn't validate where the request came from.",
  "La validación de seguridad venció. Recargá e intentá nuevamente.": "The security check expired. Reload and try again.",
  "La sesión local se cerró, pero no pudimos confirmar la revocación remota.":
    "You were logged out on this device, but we couldn't confirm the session was revoked on the server.",

  // Glosario del dominio: los mismos rótulos se usan en la app y en el backoffice.
  "Empresa turística": "Tourism company",
  "Guía": "Guide",
  "Conductor": "Driver",
  "Instructor": "Instructor",
  "Empresa de transporte": "Transport company",
  "Pendiente": "Pending",
  "Pendientes": "Pending",
  "Aceptada": "Accepted",
  "Aceptadas": "Accepted",
  "Rechazada": "Declined",
  "Rechazadas": "Declined",
  "Vencida": "Expired",
  "Vencidas": "Expired",
  "Cancelada": "Cancelled",
  "Canceladas": "Cancelled",
  "Enviadas": "Sent",
  "Recibidas": "Received",
  "Todas": "All",

  // Estados de carga y rótulos de documentos repetidos entre áreas.
  "Verificando…": "Checking…",
  "Actualizando…": "Updating…",
  "requiere vigencia": "expiry date required",
  "sin vencimiento obligatorio": "no expiry date required",
};
