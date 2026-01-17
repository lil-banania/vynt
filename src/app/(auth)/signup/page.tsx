"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

const SignupPage = () => {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [fullName, setFullName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const checkSession = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user && isMounted) {
        router.replace("/dashboard");
      }
    };

    checkSession();

    return () => {
      isMounted = false;
    };
  }, [router, supabase]);

  const handleSignup = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!companyName.trim()) {
      setErrorMessage("Company name is required.");
      setIsSubmitting(false);
      return;
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName.trim() || null,
          company_name: companyName.trim(),
        },
      },
    });

    if (error) {
      setErrorMessage(error.message);
      setIsSubmitting(false);
      return;
    }

    if (data.user && !data.session) {
      setSuccessMessage(
        "Account created! Please check your email to confirm your account."
      );
      setIsSubmitting(false);
      return;
    }

    router.replace("/dashboard");
  };

  const handleGoogleSignIn = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/api/auth/callback?redirectTo=/dashboard`,
      },
    });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-4">
      <Card className="w-full max-w-md border-border/60 shadow-sm">
        <CardHeader className="space-y-2 text-center">
          <CardTitle className="text-3xl font-semibold tracking-tight">
            Vynt
          </CardTitle>
          <CardDescription className="text-base text-muted-foreground">
            Create your account
          </CardDescription>
        </CardHeader>
        <CardContent>
          {successMessage ? (
            <div className="space-y-4">
              <p className="text-sm text-emerald-600">{successMessage}</p>
              <Button asChild variant="outline" className="w-full">
                <Link href="/login">Back to sign in</Link>
              </Button>
            </div>
          ) : (
            <>
              <form className="space-y-4" onSubmit={handleSignup}>
                <div className="space-y-2">
                  <Label htmlFor="fullName">Full name</Label>
                  <Input
                    id="fullName"
                    type="text"
                    autoComplete="name"
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    placeholder="John Doe"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="companyName">
                    Company name <span className="text-rose-500">*</span>
                  </Label>
                  <Input
                    id="companyName"
                    type="text"
                    autoComplete="organization"
                    value={companyName}
                    onChange={(event) => setCompanyName(event.target.value)}
                    placeholder="Acme Inc."
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">
                    Email <span className="text-rose-500">*</span>
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">
                    Password <span className="text-rose-500">*</span>
                  </Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    minLength={6}
                  />
                </div>
                {errorMessage && (
                  <p className="text-sm text-rose-600">{errorMessage}</p>
                )}
                <Button
                  type="submit"
                  className="w-full"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Creating account..." : "Create account"}
                </Button>
              </form>
              <div className="my-6 text-center text-xs uppercase tracking-wide text-muted-foreground">
                or
              </div>
              <Button
                type="button"
                className="w-full"
                variant="outline"
                onClick={handleGoogleSignIn}
              >
                Sign up with Google
              </Button>
              <p className="mt-6 text-center text-sm text-muted-foreground">
                Already have an account?{" "}
                <Link
                  href="/login"
                  className="font-medium text-slate-900 hover:underline"
                >
                  Sign in
                </Link>
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default SignupPage;
