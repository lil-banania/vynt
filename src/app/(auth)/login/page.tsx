"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";

const LoginPage = () => {
  const handleSignIn = async () => {
    const supabase = createClient();

    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/dashboard`,
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
            Revenue Observability for Modern SaaS
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            type="button"
            className="w-full"
            onClick={handleSignIn}
          >
            Sign in with Google
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default LoginPage;