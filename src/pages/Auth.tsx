import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { z } from "zod";
import { BookOpen, Loader2, Eye, EyeOff, ArrowRight, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { lovable } from "@/integrations/lovable/index";

const emailSchema = z.string().email("כתובת אימייל לא תקינה");
const passwordSchema = z.string().min(6, "סיסמה חייבת להכיל לפחות 6 תווים");

const REMEMBER_EMAIL_KEY = "gemara-remember-email";

type AuthMode = "signin" | "signup" | "forgot";

type PasswordInputProps = {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  show: boolean;
  onToggle: () => void;
  isLoading: boolean;
};

function PasswordInput({
  id,
  value,
  onChange,
  placeholder,
  show,
  onToggle,
  isLoading,
}: PasswordInputProps) {
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? "text" : "password"}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        required
        disabled={isLoading}
        className="pe-10"
        autoComplete={id === "password" ? "current-password" : "new-password"}
      />
      <button
        type="button"
        onClick={onToggle}
        onMouseDown={e => e.preventDefault()}
        className="absolute end-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
        aria-label={show ? "הסתר סיסמה" : "הצג סיסמה"}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

export default function Auth() {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<AuthMode>("signin");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  // Load remembered email on mount
  useEffect(() => {
    const saved = localStorage.getItem(REMEMBER_EMAIL_KEY);
    if (saved) {
      setEmail(saved);
      setRememberMe(true);
    }
  }, []);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        navigate("/");
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        navigate("/");
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const saveOrClearRememberedEmail = useCallback(() => {
    if (rememberMe && email) {
      localStorage.setItem(REMEMBER_EMAIL_KEY, email);
    } else {
      localStorage.removeItem(REMEMBER_EMAIL_KEY);
    }
  }, [rememberMe, email]);

  const validateEmail = (): boolean => {
    try { emailSchema.parse(email); return true; }
    catch (e) { if (e instanceof z.ZodError) toast.error(e.errors[0].message); return false; }
  };

  const validatePassword = (): boolean => {
    try { passwordSchema.parse(password); return true; }
    catch (e) { if (e instanceof z.ZodError) toast.error(e.errors[0].message); return false; }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateEmail() || !validatePassword()) return;

    setIsLoading(true);
    saveOrClearRememberedEmail();

    let signInResult: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>;
    try {
      signInResult = await supabase.auth.signInWithPassword({ email, password });
    } catch (storageErr: unknown) {
      // localStorage quota exceeded — clear stale data and retry once
      if (storageErr instanceof DOMException && storageErr.name === 'QuotaExceededError') {
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k !== 'remembered-email') keysToRemove.push(k);
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));
        try {
          signInResult = await supabase.auth.signInWithPassword({ email, password });
        } catch {
          setIsLoading(false);
          toast.error("הדפדפן מלא — אנא נקה את הנתונים המקומיים ונסה שוב");
          return;
        }
      } else {
        setIsLoading(false);
        toast.error("שגיאה בהתחברות — נסה שוב");
        return;
      }
    }
    setIsLoading(false);

    const { error } = signInResult;
    if (error) {
      toast.error(error.message.includes("Invalid login credentials")
        ? "אימייל או סיסמה שגויים" : error.message);
      return;
    }
    toast.success("התחברת בהצלחה!");
    navigate("/");
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateEmail() || !validatePassword()) return;
    if (password !== confirmPassword) {
      toast.error("הסיסמאות אינן תואמות");
      return;
    }

    setIsLoading(true);
    saveOrClearRememberedEmail();

    const { error } = await supabase.auth.signUp({
      email, password,
      options: { emailRedirectTo: `${window.location.origin}/` },
    });
    setIsLoading(false);

    if (error) {
      toast.error(error.message.includes("User already registered")
        ? "משתמש עם אימייל זה כבר קיים במערכת" : error.message);
      return;
    }
    toast.success("נרשמת בהצלחה! מעביר אותך לאתר...");
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateEmail()) return;

    setIsLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setIsLoading(false);

    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("קישור לאיפוס סיסמה נשלח לאימייל שלך");
  };

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });

    if (result.error) {
      setIsLoading(false);
      toast.error("ההתחברות עם גוגל נכשלה — נסה שוב");
      return;
    }

    if (result.redirected) return;

    setIsLoading(false);
    toast.success("התחברת בהצלחה!");
    navigate("/");
  };

  const switchMode = (newMode: AuthMode) => {
    setMode(newMode);
    setShowPassword(false);
    setShowConfirmPassword(false);
  };

  const title = mode === "signin" ? "התחברות" : mode === "signup" ? "הרשמה" : "שכחתי סיסמה";
  const description = mode === "signin"
    ? "הזן את פרטי ההתחברות שלך"
    : mode === "signup"
    ? "צור חשבון חדש כדי לגשת לכל התכונות"
    : "נשלח לך קישור לאיפוס הסיסמה";

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4" dir="rtl">
      <Card className="w-full max-w-md overflow-hidden">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <BookOpen className="h-12 w-12 text-primary" />
          </div>
          <CardTitle className="text-2xl">גמרא להלכה</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          {/* Mode selector pills */}
          <div className="flex gap-1 p-1 mb-6 bg-muted rounded-lg">
            {([["signin", "התחברות"], ["signup", "הרשמה"]] as const).map(([m, label]) => (
              <button
                key={m}
                type="button"
                onClick={() => switchMode(m)}
                className={cn(
                  "flex-1 py-2 text-sm font-medium rounded-md transition-all duration-200",
                  mode === m
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <form
            onSubmit={mode === "signin" ? handleSignIn : mode === "signup" ? handleSignUp : handleForgotPassword}
            className="space-y-4"
          >
            {/* Email — always visible */}
            <div className="space-y-2">
              <Label htmlFor="email">אימייל</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
                disabled={isLoading}
              />
            </div>

            {/* Password — signin & signup */}
            {mode !== "forgot" && (
              <div className="space-y-2">
                <Label htmlFor="password">סיסמה</Label>
                <PasswordInput
                  id="password"
                  value={password}
                  onChange={setPassword}
                  placeholder={mode === "signup" ? "לפחות 6 תווים" : "••••••••"}
                  show={showPassword}
                  onToggle={() => setShowPassword(p => !p)}
                  isLoading={isLoading}
                />
              </div>
            )}

            {/* Confirm password — signup only */}
            {mode === "signup" && (
              <div className="space-y-2">
                <Label htmlFor="confirm-password">אימות סיסמה</Label>
                <PasswordInput
                  id="confirm-password"
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  placeholder="הקלד שוב את הסיסמה"
                  show={showConfirmPassword}
                  onToggle={() => setShowConfirmPassword(p => !p)}
                  isLoading={isLoading}
                />
              </div>
            )}

            {/* Remember me & forgot password — signin only */}
            {mode === "signin" && (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="remember"
                    checked={rememberMe}
                    onCheckedChange={c => setRememberMe(!!c)}
                  />
                  <Label htmlFor="remember" className="text-sm cursor-pointer font-normal">
                    זכור אותי
                  </Label>
                </div>
                <button
                  type="button"
                  onClick={() => switchMode("forgot")}
                  className="text-sm text-primary hover:underline"
                >
                  שכחתי סיסמה
                </button>
              </div>
            )}

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? (
                <><Loader2 className="me-2 h-4 w-4 animate-spin" />
                  {mode === "signin" ? "מתחבר..." : mode === "signup" ? "נרשם..." : "שולח..."}
                </>
              ) : (
                mode === "signin" ? "התחבר" : mode === "signup" ? "הירשם" : "שלח קישור איפוס"
              )}
            </Button>

            {/* Back to signin from forgot */}
            {mode === "forgot" && (
              <button
                type="button"
                onClick={() => switchMode("signin")}
                className="flex items-center gap-1 mx-auto text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowRight className="h-4 w-4" />
                חזרה להתחברות
              </button>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
