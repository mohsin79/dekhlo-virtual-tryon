export function mapAuthErrorMessage(error: { message?: string; code?: string } | null): string {
  if (!error?.message) {
    return "Something went wrong. Please try again.";
  }

  const message = error.message.toLowerCase();

  if (message.includes("invalid login credentials")) {
    return "Invalid email or password.";
  }

  if (message.includes("email not confirmed")) {
    return "Please confirm your email before signing in.";
  }

  if (message.includes("user already registered")) {
    return "An account with this email may already exist.";
  }

  if (message.includes("password should be at least")) {
    return "Password does not meet the minimum requirements.";
  }

  if (message.includes("token has expired") || message.includes("otp has expired")) {
    return "This link has expired. Please request a new one.";
  }

  if (message.includes("invalid token") || message.includes("invalid otp")) {
    return "This link is invalid or has already been used.";
  }

  return "Something went wrong. Please try again.";
}

export function mapBrandOnboardingErrorMessage(
  error: { message?: string; code?: string } | null,
): string {
  if (!error?.message) {
    return "Unable to create your brand. Please try again.";
  }

  const message = error.message.toLowerCase();

  if (message.includes("slug already exists") || error.code === "23505") {
    return "That brand URL is already taken. Choose a different slug.";
  }

  if (message.includes("invalid brand slug")) {
    return "Use lowercase letters, numbers and single hyphens only.";
  }

  if (message.includes("brand name is required")) {
    return "Brand name is required.";
  }

  if (message.includes("brand slug is required")) {
    return "Brand slug is required.";
  }

  if (message.includes("too long")) {
    return "One of the fields is too long.";
  }

  if (message.includes("authentication required")) {
    return "Please sign in again to continue.";
  }

  return "Unable to create your brand. Please try again.";
}
