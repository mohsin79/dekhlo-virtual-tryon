import Link from "next/link";
import { Logo } from "@/components/Logo";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-bg px-4 py-10">
      <div className="mx-auto flex w-full max-w-md flex-col gap-8">
        <div className="flex justify-center">
          <Link href="/" className="no-underline">
            <Logo />
          </Link>
        </div>
        {children}
      </div>
    </div>
  );
}
