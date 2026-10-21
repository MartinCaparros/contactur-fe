"use client";

import { type FormEvent, useEffect, useState } from "react";

import { useT } from "@/lib/i18n/LocaleProvider";

import { DocumentsPanel } from "./DocumentsPanel";
import { ProfileDataStep, selectedIds, updatePayload } from "./OnboardingPage";
import {
  ApiRequestError,
  type AccessEvaluation,
  type Catalogs,
  type Profile,
  firstFieldError,
  getBrowserJson,
  isCatalogsResponse,
  isMediaResponse,
  isProfileResponse,
  mutateBrowserFormData,
  mutateBrowserNoContent,
} from "./api";
import { persistProfileData } from "./profilePersistence";
import styles from "./ProfileEditor.module.css";

type FieldErrors = Readonly<Record<string, readonly string[]>>;
/** `message: null` = error sin mensaje propio; se muestra el texto genérico en el idioma activo. */
type CatalogState =
  | { status: "loading" }
  | { status: "ready"; catalogs: Catalogs }
  | { status: "error"; message: string | null };

type ProfileEditorProps = Readonly<{
  profile: Profile;
  access: AccessEvaluation | null;
  onProfileChange: (profile: Profile) => void;
}>;

function messageFrom(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

/** Mensaje propio del error o `null` para usar el genérico al mostrarlo. */
function errorMessage(reason: unknown): string | null {
  return reason instanceof Error ? reason.message : null;
}

function fieldsFrom(reason: unknown): FieldErrors {
  return reason instanceof ApiRequestError ? reason.fields : {};
}

function redirectIfUnauthorized(reason: unknown): boolean {
  if (!(reason instanceof ApiRequestError) || reason.status !== 401) return false;
  const returnTo = `${window.location.pathname}${window.location.search}`;
  window.location.replace(`/?auth=login&returnTo=${encodeURIComponent(returnTo)}`);
  return true;
}

function mediaErrorId(kind: "avatar" | "gallery", field: string): string {
  return `${kind}-${field}-error`;
}

function MediaFieldError({ kind, fields, name }: Readonly<{ kind: "avatar" | "gallery"; fields: FieldErrors; name: string }>) {
  const message = firstFieldError(fields, name);
  return message ? <span id={mediaErrorId(kind, name)} className={styles.fieldError} role="alert">{message}</span> : null;
}

function mediaFieldProps(kind: "avatar" | "gallery", fields: FieldErrors, name: string) {
  const invalid = Boolean(firstFieldError(fields, name));
  return {
    "aria-invalid": invalid || undefined,
    "aria-describedby": invalid ? mediaErrorId(kind, name) : undefined,
  } as const;
}

export function ProfileEditor({ profile, access, onProfileChange }: ProfileEditorProps) {
  const t = useT();
  const [catalogState, setCatalogState] = useState<CatalogState>({ status: "loading" });
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileErrors, setProfileErrors] = useState<FieldErrors>({});
  const [profileNotice, setProfileNotice] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarRefreshPending, setAvatarRefreshPending] = useState(false);
  const [avatarErrors, setAvatarErrors] = useState<FieldErrors>({});
  const [avatarNotice, setAvatarNotice] = useState<string | null>(null);
  const [galleryBusy, setGalleryBusy] = useState(false);
  const [galleryRefreshPending, setGalleryRefreshPending] = useState(false);
  const [galleryErrors, setGalleryErrors] = useState<FieldErrors>({});
  const [galleryNotice, setGalleryNotice] = useState<string | null>(null);
  const [deletingGalleryId, setDeletingGalleryId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void getBrowserJson(
      "/api/backend/v1/catalogs?per_page=50",
      isCatalogsResponse,
      controller.signal,
    )
      .then((response) => setCatalogState({ status: "ready", catalogs: response.data }))
      .catch((reason: unknown) => {
        if (controller.signal.aborted || redirectIfUnauthorized(reason)) return;
        setCatalogState({ status: "error", message: errorMessage(reason) });
      });
    return () => controller.abort();
  }, [profile.id]);

  const refreshProfile = async () => {
    const response = await getBrowserJson(
      `/api/backend/v1/profiles/${profile.id}`,
      isProfileResponse,
    );
    onProfileChange(response.data);
  };

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = updatePayload(profile.category, form);
    const cityIds = selectedIds(form, "city_ids");
    setProfileBusy(true);
    setProfileErrors({});
    setProfileNotice(null);
    try {
      const updated = await persistProfileData(profile, payload, cityIds);
      onProfileChange(updated);
      setProfileNotice(t("Los datos del perfil quedaron actualizados."));
    } catch (reason) {
      if (redirectIfUnauthorized(reason)) return;
      setProfileErrors(fieldsFrom(reason));
      setProfileNotice(messageFrom(reason, t("No pudimos actualizar el perfil.")));
    } finally {
      setProfileBusy(false);
    }
  };

  const retryMediaRefresh = async (kind: "avatar" | "gallery") => {
    const setBusy = kind === "avatar" ? setAvatarBusy : setGalleryBusy;
    const setRefreshPending = kind === "avatar" ? setAvatarRefreshPending : setGalleryRefreshPending;
    const setNotice = kind === "avatar" ? setAvatarNotice : setGalleryNotice;
    setBusy(true);
    try {
      await refreshProfile();
      setRefreshPending(false);
      setNotice(t("La información del perfil quedó actualizada."));
    } catch (reason) {
      if (redirectIfUnauthorized(reason)) return;
      setNotice(t("El archivo está guardado, no pudimos refrescar el perfil. Reintentá la actualización; no vuelvas a subirlo."));
    } finally {
      setBusy(false);
    }
  };

  const uploadAvatar = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const imageControl = formElement.elements.namedItem("image");
    const image = imageControl instanceof HTMLInputElement ? imageControl.files?.[0] : undefined;
    const multipart = new FormData();
    if (image) multipart.append("image", image);
    setAvatarBusy(true);
    setAvatarRefreshPending(false);
    setAvatarErrors({});
    setAvatarNotice(null);
    try {
      await mutateBrowserFormData(
        `/api/backend/v1/profiles/${profile.id}/avatar`,
        multipart,
        isMediaResponse,
      );
    } catch (reason) {
      if (redirectIfUnauthorized(reason)) {
        setAvatarBusy(false);
        return;
      }
      setAvatarErrors(fieldsFrom(reason));
      setAvatarNotice(messageFrom(reason, t("No pudimos actualizar el avatar.")));
      setAvatarBusy(false);
      return;
    }

    formElement.reset();
    try {
      await refreshProfile();
      setAvatarNotice(t("Avatar actualizado."));
    } catch (reason) {
      if (redirectIfUnauthorized(reason)) return;
      setAvatarRefreshPending(true);
      setAvatarNotice(t("Avatar guardado, no pudimos refrescar el perfil. Reintentá la actualización; no vuelvas a subir el archivo."));
    } finally {
      setAvatarBusy(false);
    }
  };

  const uploadGallery = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!access?.capabilities.can_use_gallery) return;
    const formElement = event.currentTarget;
    const values = new FormData(formElement);
    const imageControl = formElement.elements.namedItem("image");
    const image = imageControl instanceof HTMLInputElement ? imageControl.files?.[0] : undefined;
    const position = values.get("position");
    const multipart = new FormData();
    if (image) multipart.append("image", image);
    if (typeof position === "string" && position !== "") multipart.append("position", position);
    setGalleryBusy(true);
    setGalleryRefreshPending(false);
    setGalleryErrors({});
    setGalleryNotice(null);
    try {
      await mutateBrowserFormData(
        `/api/backend/v1/profiles/${profile.id}/gallery`,
        multipart,
        isMediaResponse,
      );
    } catch (reason) {
      if (redirectIfUnauthorized(reason)) {
        setGalleryBusy(false);
        return;
      }
      setGalleryErrors(fieldsFrom(reason));
      setGalleryNotice(messageFrom(reason, t("No pudimos agregar la imagen.")));
      setGalleryBusy(false);
      return;
    }

    formElement.reset();
    try {
      await refreshProfile();
      setGalleryNotice(t("Imagen agregada a la galería."));
    } catch (reason) {
      if (redirectIfUnauthorized(reason)) return;
      setGalleryRefreshPending(true);
      setGalleryNotice(t("Imagen guardada, no pudimos refrescar el perfil. Reintentá la actualización; no vuelvas a subir el archivo."));
    } finally {
      setGalleryBusy(false);
    }
  };

  const removeGallery = async (imageId: string) => {
    if (!access?.capabilities.can_use_gallery) return;
    setDeletingGalleryId(imageId);
    setGalleryNotice(null);
    try {
      await mutateBrowserNoContent(
        `/api/backend/v1/profiles/${profile.id}/gallery/${imageId}`,
        "DELETE",
      );
      await refreshProfile();
      setGalleryNotice(t("Imagen eliminada de la galería."));
    } catch (reason) {
      if (redirectIfUnauthorized(reason)) return;
      setGalleryNotice(messageFrom(reason, t("No pudimos eliminar la imagen.")));
    } finally {
      setDeletingGalleryId(null);
    }
  };

  const galleryAllowed = access?.capabilities.can_use_gallery === true;

  return (
    <section className={styles.panel} aria-labelledby="profile-editor-title">
      <p className={styles.eyebrow}>{t("Perfil activo")}</p>
      <h1 id="profile-editor-title">{t("Editar perfil")}</h1>
      <p className={styles.lead}>{t("Actualizá los datos profesionales, la documentación y la media del perfil seleccionado.")}</p>

      <section className={styles.section} aria-labelledby="profile-data-title">
        <h2 id="profile-data-title">{t("Datos y cobertura")}</h2>
        {catalogState.status === "loading" ? <p role="status">{t("Cargando catálogos…")}</p> : null}
        {catalogState.status === "error" ? <div className={styles.errorNotice} role="alert">{catalogState.message ?? t("No pudimos cargar los catálogos.")}</div> : null}
        {profileNotice ? <div className={Object.keys(profileErrors).length > 0 ? styles.errorNotice : styles.successNotice} role={Object.keys(profileErrors).length > 0 ? "alert" : "status"}>{profileNotice}</div> : null}
        {catalogState.status === "ready" ? (
          <ProfileDataStep
            catalogs={catalogState.catalogs}
            profile={profile}
            busy={profileBusy}
            fields={profileErrors}
            onSubmit={saveProfile}
            submitLabel={t("Guardar perfil")}
          />
        ) : null}
      </section>

      <section className={styles.section} aria-labelledby="avatar-title">
        <h2 id="avatar-title">{t("Avatar o logo")}</h2>
        <div className={styles.mediaRow}>
          {profile.avatar ? (
            <div className={styles.avatarPreview} role="img" aria-label={t("Avatar actual")} style={{ backgroundImage: `url(${JSON.stringify(profile.avatar.url)})` }} />
          ) : <div className={styles.avatarFallback} aria-label={t("Sin avatar")}>{profile.display_name.slice(0, 1).toLocaleUpperCase("es")}</div>}
          <form className={styles.mediaForm} onSubmit={(event) => void uploadAvatar(event)} noValidate>
            <label>{t("Nueva imagen JPEG o PNG")}
              <input name="image" type="file" accept="image/jpeg,image/png" required {...mediaFieldProps("avatar", avatarErrors, "image")} />
              <MediaFieldError kind="avatar" fields={avatarErrors} name="image" />
            </label>
            {avatarNotice ? <p role={Object.keys(avatarErrors).length > 0 ? "alert" : "status"}>{avatarNotice}</p> : null}
            {avatarRefreshPending ? <button type="button" onClick={() => void retryMediaRefresh("avatar")} disabled={avatarBusy}>{t("Reintentar actualización del avatar")}</button> : null}
            <button type="submit" disabled={avatarBusy}>{avatarBusy ? t("Subiendo…") : t("Actualizar avatar")}</button>
          </form>
        </div>
      </section>

      {catalogState.status === "ready" ? (
        <section className={styles.section} aria-labelledby="documents-title">
          <h2 id="documents-title">{t("Documentos")}</h2>
          <p>{t("Los archivos legales se descargan únicamente a través del BFF autenticado. Nunca se muestra su ubicación interna.")}</p>
          <DocumentsPanel
            profileId={profile.id}
            documentTypes={catalogState.catalogs.document_types.filter((type) => type.category === profile.category)}
            onProfileChange={onProfileChange}
          />
        </section>
      ) : null}

      <section className={styles.section} aria-labelledby="gallery-title">
        <h2 id="gallery-title">{t("Galería")}</h2>
        {!galleryAllowed ? (
          <div className={styles.lockedNotice} role="status">
            <strong>{t("Galería bloqueada por la habilitación actual")}</strong>
            <p>{access === null
              ? t("No pudimos comprobar la capacidad can_use_gallery; por seguridad no se permiten cargas ni eliminaciones.")
              : t("El servidor informó access.capabilities.can_use_gallery=false. Podés editar el resto del perfil y consultar Acceso para ver tu habilitación real.")}</p>
          </div>
        ) : (
          <>
            <form className={styles.mediaForm} onSubmit={(event) => void uploadGallery(event)} noValidate>
              <label>{t("Imagen JPEG o PNG")}
                <input name="image" type="file" accept="image/jpeg,image/png" required {...mediaFieldProps("gallery", galleryErrors, "image")} />
                <MediaFieldError kind="gallery" fields={galleryErrors} name="image" />
              </label>
              <label>{t("Posición, si querés insertarla")}
                <input name="position" type="number" min="0" max={profile.gallery.length} {...mediaFieldProps("gallery", galleryErrors, "position")} />
                <MediaFieldError kind="gallery" fields={galleryErrors} name="position" />
              </label>
              {galleryNotice ? <p role={Object.keys(galleryErrors).length > 0 ? "alert" : "status"}>{galleryNotice}</p> : null}
              {galleryRefreshPending ? <button type="button" onClick={() => void retryMediaRefresh("gallery")} disabled={galleryBusy}>{t("Reintentar actualización de la galería")}</button> : null}
              <button type="submit" disabled={galleryBusy}>{galleryBusy ? t("Subiendo…") : t("Agregar a galería")}</button>
            </form>
            {profile.gallery.length === 0 ? <p>{t("No hay imágenes en la galería.")}</p> : (
              <ul className={styles.galleryList}>
                {profile.gallery.map((image, index) => (
                  <li key={image.id}>
                    <div role="img" aria-label={t("Imagen {number} de la galería", { number: index + 1 })} style={{ backgroundImage: `url(${JSON.stringify(image.url)})` }} />
                    <span>{t("Posición {position}", { position: image.position })}</span>
                    <button type="button" onClick={() => void removeGallery(image.id)} disabled={deletingGalleryId === image.id}>
                      {deletingGalleryId === image.id ? t("Eliminando…") : t("Eliminar imagen")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </section>
  );
}
