import Link from "next/link";
import { redirect } from "next/navigation";
import { OnboardingForm } from "@/components/auth/onboarding-form";
import { Logo } from "@/components/Logo";
import { requireUserContext } from "@/lib/auth/get-user-context";

export default async function OnboardingPage() {
  const context = await requireUserContext("/onboarding");

  if (context.memberships.length > 0) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen bg-bg px-4 py-10">
      <div className="mx-auto flex w-full max-w-md flex-col gap-8">
        <div className="flex justify-center">
          <Link href="/" className="no-underline">
            <Logo />
          </Link>
        </div>
        <OnboardingForm />
      </div>
    </div>
  );
}
