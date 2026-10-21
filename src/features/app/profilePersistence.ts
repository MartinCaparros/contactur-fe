import {
  type Profile,
  type ReplaceCitiesInput,
  type UpdateProfileInput,
  getBrowserJson,
  isProfileCitiesResponse,
  isProfileResponse,
  mutateBrowserJson,
} from "./api";

async function replaceCities(profileId: string, cityIds: number[]): Promise<void> {
  const payload: ReplaceCitiesInput = { city_ids: cityIds };
  await mutateBrowserJson(
    `/api/backend/v1/profiles/${profileId}/cities`,
    "PUT",
    payload,
    isProfileCitiesResponse,
  );
}

async function patchProfile(profileId: string, payload: UpdateProfileInput): Promise<void> {
  await mutateBrowserJson(
    `/api/backend/v1/profiles/${profileId}`,
    "PATCH",
    payload,
    isProfileResponse,
  );
}

export async function persistProfileData(
  profile: Profile,
  payload: UpdateProfileInput,
  cityIds: number[],
): Promise<Profile> {
  const currentPrimaryId = profile.primary_city?.id ?? null;
  const nextPrimaryId = payload.primary_city_id ?? null;
  const removesCurrentPrimary = currentPrimaryId !== null && !cityIds.includes(currentPrimaryId);
  const currentCityIds = profile.cities.map((city) => city.id);

  if (removesCurrentPrimary && nextPrimaryId !== null && currentCityIds.includes(nextPrimaryId)) {
    await patchProfile(profile.id, payload);
    await replaceCities(profile.id, cityIds);
  } else if (removesCurrentPrimary && nextPrimaryId !== null) {
    const transitionCities = [...new Set([...currentCityIds, ...cityIds, nextPrimaryId])];
    await replaceCities(profile.id, transitionCities);
    await patchProfile(profile.id, payload);
    await replaceCities(profile.id, cityIds);
  } else if (removesCurrentPrimary) {
    await patchProfile(profile.id, payload);
    await replaceCities(profile.id, cityIds);
  } else {
    await replaceCities(profile.id, cityIds);
    await patchProfile(profile.id, payload);
  }

  const refreshed = await getBrowserJson(
    `/api/backend/v1/profiles/${profile.id}`,
    isProfileResponse,
  );
  return refreshed.data;
}
