import type { ProductTryOnPhase } from "@/lib/try-on/sessions/session-upload-eligibility";

const BUSY_PHASES: ProductTryOnPhase[] = [
  "creating",
  "optimizing",
  "uploading",
  "validating",
  "polling",
];

export function isProductTryOnBusy(phase: ProductTryOnPhase): boolean {
  return BUSY_PHASES.includes(phase);
}

export function canStartProductTryOnGeneration(input: {
  phase: ProductTryOnPhase;
  hasPersonFile: boolean;
}): boolean {
  if (!input.hasPersonFile) {
    return false;
  }

  if (isProductTryOnBusy(input.phase)) {
    return false;
  }

  return input.phase === "photo_selected" || input.phase === "idle" || input.phase === "error";
}

export function phaseAfterPersonPhotoSelected(currentPhase: ProductTryOnPhase): ProductTryOnPhase {
  if (currentPhase === "awaiting_new_photo" || currentPhase === "idle" || currentPhase === "error") {
    return "photo_selected";
  }

  return currentPhase;
}

export function phaseAfterChooseAnotherPhoto(): ProductTryOnPhase {
  return "awaiting_new_photo";
}

export const GENERATE_TRY_ON_LABEL = "Generate try-on";
export const CHOOSE_ANOTHER_PHOTO_LABEL = "Choose another photo";
