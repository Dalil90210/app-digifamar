import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { z } from "zod";
import { toast } from "sonner";
import {
  ShoppingCart,
  UtensilsCrossed,
  Store,
  Truck,
  Eye,
  EyeOff,
  CheckCircle2,
  Loader2,
  ArrowLeft,
  Shield,
  Phone,
  Leaf,
  RotateCcw,
  Lock,
  FlaskConical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Logo } from "@/components/Logo";
import { supabase } from "@/integrations/supabase/client";
import { formatUSInput, isValidPhone, normalizeToE164 } from "@/lib/phone";

export const Route = createFileRoute("/signup/buyer")({
  head: () => ({
    meta: [
      { title: "Buyer Registration — DiGiFaMaR" },
      {
        name: "description",
        content:
          "Register as a buyer on DiGiFaMaR. Shop direct from local farms with escrow protection.",
      },
    ],
  }),
  component: BuyerSignup,
});

// ─────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────

const BUYER_TYPES = [
  {
    id: "individual",
    emoji: "🛒",
    label: "Individual / Family",
    description: "Personal household grocery shopping",
    Icon: ShoppingCart,
  },
  {
    id: "restaurant",
    emoji: "🍽️",
    label: "Restaurant / Food Service",
    description: "Restaurants, cafes & caterers",
    Icon: UtensilsCrossed,
  },
  {
    id: "retailer",
    emoji: "🏪",
    label: "Retailer / Grocery Store",
    description: "Supermarkets, co-ops & specialty stores",
    Icon: Store,
  },
  {
    id: "distributor",
    emoji: "🚚",
    label: "Distributor / Wholesaler",
    description: "Wholesale buyers & regional distributors",
    Icon: Truck,
  },
] as const;

type BuyerTypeId = (typeof BUYER_TYPES)[number]["id"];

const US_STATES = [
  { code: "AL", name: "Alabama" },
  { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" },
  { code: "DE", name: "Delaware" },
  { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
];

// ─────────────────────────────────────────────────────────────────
// VALIDATION SCHEMAS
// ─────────────────────────────────────────────────────────────────

const step2Schema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(60),
  lastName: z.string().trim().min(1, "Last name is required").max(60),
  businessName: z.string().trim().max(120).optional(),
  email: z.string().trim().email("Enter a valid email address").max(255),
  phone: z
    .string()
    .trim()
    .refine((v) => isValidPhone(v), {
      message: "Enter a valid US phone number, e.g. (555) 123-4567",
    }),
  city: z.string().trim().min(1, "City is required").max(100),
  state: z.string().min(2, "Please select a state"),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
});

type Step2Data = z.infer<typeof step2Schema>;
type Step2Errors = Partial<Record<keyof Step2Data, string>>;

// ─────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────

const formatPhone = formatUSInput;

// ─────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────

function BuyerSignup() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);

  // Step 1
  const [buyerType, setBuyerType] = useState<BuyerTypeId | "">("");

  // Step 2
  const [step2, setStep2] = useState({
    firstName: "",
    lastName: "",
    businessName: "",
    email: "",
    phone: "",
    city: "",
    state: "",
    password: "",
  });
  const [step2Errors, setStep2Errors] = useState<Step2Errors>({});
  const [showPassword, setShowPassword] = useState(false);

  // Step 3
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [termsChecked, setTermsChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  const otpComplete = otp.every((d) => d.length === 1);
  const canSubmit = otpComplete && termsChecked && !submitting;
  const isIndividual = buyerType === "individual";

  const updateStep2 = <K extends keyof typeof step2>(key: K, value: (typeof step2)[K]) => {
    setStep2((p) => ({ ...p, [key]: value }));
    setStep2Errors((e) => ({ ...e, [key]: undefined }));
  };

  const handleOtpChange = (index: number, value: string) => {
    const digit = value.replace(/\D/, "").slice(-1);
    const next = [...otp];
    next[index] = digit;
    setOtp(next);
    if (digit && index < 5) otpRefs.current[index + 1]?.focus();
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const paste = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (paste.length === 6) {
      setOtp(paste.split(""));
      otpRefs.current[5]?.focus();
    }
  };

  const validateStep1 = () => {
    if (!buyerType) {
      toast.error("Please select a buyer type to continue");
      return false;
    }
    return true;
  };

  const validateStep2 = () => {
    const result = step2Schema.safeParse(step2);
    const errs: Step2Errors = {};
    if (!result.success) {
      for (const issue of result.error.issues) {
        const k = issue.path[0] as keyof Step2Data;
        if (!errs[k]) errs[k] = issue.message;
      }
    }
    if (!isIndividual && !step2.businessName.trim()) {
      errs.businessName = "Business name is required";
    }
    if (Object.keys(errs).length > 0) {
      setStep2Errors(errs);
      return false;
    }
    setStep2Errors({});
    return true;
  };

  const handleNext = () => {
    if (step === 1 && !validateStep1()) return;
    if (step === 2 && !validateStep2()) {
      toast.error("Please fix the highlighted fields");
      return;
    }
    setStep((s) => s + 1);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: step2.email,
        password: step2.password,
        options: {
          data: {
            full_name: `${step2.firstName} ${step2.lastName}`,
            phone: normalizeToE164(step2.phone) ?? step2.phone,
            // Role is assigned server-side by the handle_new_user() trigger from
            // this metadata (client-side user_roles writes are revoked by RLS).
            role: "buyer",
          },
        },
      });
      if (error) throw error;

      const userId = data.user?.id;
      if (!userId) throw new Error("Signup failed — please try again.");

      await supabase.from("buyer_profiles").insert({
        user_id: userId,
        buyer_type: buyerType,
        business_name: !isIndividual ? step2.businessName || null : null,
        city: step2.city,
        state: step2.state,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      setStep(4);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Registration failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0A0F0A] via-[#121A12] to-[#0A0F0A] text-white flex flex-col items-center justify-center p-6">
      {step < 4 && <StepIndicator current={step} />}

      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <Logo size="md" glow />
        </div>

        {step === 1 && (
          <Step1 selected={buyerType} onSelect={(id) => setBuyerType(id)} onNext={handleNext} />
        )}
        {step === 2 && (
          <Step2
            data={step2}
            errors={step2Errors}
            showPassword={showPassword}
            isIndividual={isIndividual}
            onTogglePassword={() => setShowPassword((v) => !v)}
            onUpdate={updateStep2}
            onNext={handleNext}
            onBack={() => setStep(1)}
          />
        )}
        {step === 3 && (
          <Step3
            email={step2.email}
            otp={otp}
            otpRefs={otpRefs}
            onOtpChange={handleOtpChange}
            onOtpKeyDown={handleOtpKeyDown}
            onOtpPaste={handleOtpPaste}
            termsChecked={termsChecked}
            onTermsChange={setTermsChecked}
            canSubmit={canSubmit}
            submitting={submitting}
            onSubmit={handleSubmit}
            onBack={() => setStep(2)}
          />
        )}
        {step === 4 && (
          <Step4 firstName={step2.firstName} onBrowse={() => navigate({ to: "/market" })} />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// STEP INDICATOR
// ─────────────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: number }) {
  const labels = ["Buyer Type", "Your Details", "Verify"];
  return (
    <div className="w-full max-w-md mb-8">
      <div className="flex items-center">
        {labels.map((label, i) => {
          const idx = i + 1;
          const done = current > idx;
          const active = current === idx;
          return (
            <div key={label} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                    done
                      ? "bg-[#22C55E] text-black"
                      : active
                        ? "bg-white text-black"
                        : "bg-white/10 text-white/40"
                  }`}
                >
                  {done ? <CheckCircle2 className="w-4 h-4" /> : idx}
                </div>
                <span
                  className={`mt-1 text-[10px] whitespace-nowrap ${
                    active ? "text-white" : done ? "text-[#22C55E]" : "text-white/30"
                  }`}
                >
                  {label}
                </span>
              </div>
              {i < labels.length - 1 && (
                <div
                  className="flex-1 h-px mx-2 mb-4 transition-all"
                  style={{
                    background: done ? "#22C55E" : "rgba(255,255,255,0.1)",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// STEP 1 — Buyer Type
// ─────────────────────────────────────────────────────────────────

function Step1({
  selected,
  onSelect,
  onNext,
}: {
  selected: BuyerTypeId | "";
  onSelect: (id: BuyerTypeId) => void;
  onNext: () => void;
}) {
  return (
    <div>
      <div className="mb-6">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-white/60 mb-3">
          <ShoppingCart className="h-3 w-3" /> Step 1 of 3
        </div>
        <h1 className="text-2xl font-bold">I'm buying as a…</h1>
        <p className="text-sm text-white/50 mt-1">Select the option that best describes you</p>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-2">
        {BUYER_TYPES.map((type) => {
          const isSelected = selected === type.id;
          return (
            <button
              key={type.id}
              type="button"
              onClick={() => onSelect(type.id)}
              className={`relative flex flex-col items-start gap-2 rounded-2xl border-2 p-4 text-left transition-all ${
                isSelected
                  ? "border-[#22C55E] bg-[#22C55E]/10"
                  : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/[0.08]"
              }`}
            >
              {isSelected && (
                <CheckCircle2 className="absolute top-3 right-3 h-4 w-4 text-[#22C55E]" />
              )}
              <span className="text-2xl leading-none">{type.emoji}</span>
              <span className="font-semibold text-sm leading-tight">{type.label}</span>
              <span className="text-xs text-white/50 leading-snug">{type.description}</span>
            </button>
          );
        })}
      </div>

      <Button
        onClick={onNext}
        className="w-full mt-6 bg-[#22C55E] hover:bg-[#16A34A] text-black font-semibold h-12 rounded-2xl"
      >
        Continue
      </Button>

      <p className="text-center text-xs text-white/30 mt-4">
        Already have an account?{" "}
        <Link to="/auth" search={{ tab: "signin" }} className="text-[#22C55E] hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// STEP 2 — Your Details
// ─────────────────────────────────────────────────────────────────

function Step2({
  data,
  errors,
  showPassword,
  isIndividual,
  onTogglePassword,
  onUpdate,
  onNext,
  onBack,
}: {
  data: {
    firstName: string;
    lastName: string;
    businessName: string;
    email: string;
    phone: string;
    city: string;
    state: string;
    password: string;
  };
  errors: Step2Errors;
  showPassword: boolean;
  isIndividual: boolean;
  onTogglePassword: () => void;
  onUpdate: <
    K extends
      | "firstName"
      | "lastName"
      | "businessName"
      | "email"
      | "phone"
      | "city"
      | "state"
      | "password",
  >(
    key: K,
    value: string,
  ) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <div>
      <div className="mb-6">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-white/60 mb-3">
          <ShoppingCart className="h-3 w-3" /> Step 2 of 3
        </div>
        <h1 className="text-2xl font-bold">Your Details</h1>
        <p className="text-sm text-white/50 mt-1">Tell us about yourself</p>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <FormField label="First Name" error={errors.firstName}>
            <Input
              value={data.firstName}
              onChange={(e) => onUpdate("firstName", e.target.value)}
              placeholder="Jane"
              autoComplete="given-name"
              maxLength={60}
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-[#22C55E] focus:ring-[#22C55E]/20"
            />
          </FormField>
          <FormField label="Last Name" error={errors.lastName}>
            <Input
              value={data.lastName}
              onChange={(e) => onUpdate("lastName", e.target.value)}
              placeholder="Doe"
              autoComplete="family-name"
              maxLength={60}
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-[#22C55E] focus:ring-[#22C55E]/20"
            />
          </FormField>
        </div>

        {!isIndividual && (
          <FormField label="Business Name" error={errors.businessName}>
            <Input
              value={data.businessName}
              onChange={(e) => onUpdate("businessName", e.target.value)}
              placeholder="Sunrise Restaurant Group"
              autoComplete="organization"
              maxLength={120}
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-[#22C55E] focus:ring-[#22C55E]/20"
            />
          </FormField>
        )}

        <FormField label="Email Address" error={errors.email}>
          <Input
            type="email"
            value={data.email}
            onChange={(e) => onUpdate("email", e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            maxLength={255}
            className="bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-[#22C55E] focus:ring-[#22C55E]/20"
          />
        </FormField>

        <FormField label="Phone Number" error={errors.phone}>
          <Input
            type="tel"
            value={data.phone}
            onChange={(e) => onUpdate("phone", formatPhone(e.target.value))}
            placeholder="(555) 123-4567"
            autoComplete="tel"
            inputMode="numeric"
            maxLength={14}
            className="bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-[#22C55E] focus:ring-[#22C55E]/20"
          />
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="City" error={errors.city}>
            <Input
              value={data.city}
              onChange={(e) => onUpdate("city", e.target.value)}
              placeholder="Chicago"
              autoComplete="address-level2"
              maxLength={100}
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-[#22C55E] focus:ring-[#22C55E]/20"
            />
          </FormField>
          <FormField label="State" error={errors.state}>
            <Select value={data.state} onValueChange={(v) => onUpdate("state", v)}>
              <SelectTrigger className="bg-white/5 border-white/10 text-white focus:ring-[#22C55E]/20">
                <SelectValue placeholder="State" />
              </SelectTrigger>
              <SelectContent className="max-h-64 bg-[#1a2a1a] border-white/10">
                {US_STATES.map((s) => (
                  <SelectItem
                    key={s.code}
                    value={s.code}
                    className="text-white focus:bg-white/10 focus:text-white"
                  >
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </div>

        <FormField label="Password" error={errors.password}>
          <div className="relative">
            <Input
              type={showPassword ? "text" : "password"}
              value={data.password}
              onChange={(e) => onUpdate("password", e.target.value)}
              placeholder="Min. 8 characters"
              autoComplete="new-password"
              maxLength={128}
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-[#22C55E] focus:ring-[#22C55E]/20 pr-10"
            />
            <button
              type="button"
              onClick={onTogglePassword}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition-colors"
              tabIndex={-1}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </FormField>

        {/* Escrow info box */}
        <div className="flex items-start gap-3 rounded-2xl border border-[#22C55E]/20 bg-[#22C55E]/5 p-4">
          <Shield className="h-4 w-4 text-[#22C55E] mt-0.5 shrink-0" />
          <p className="text-xs text-white/70 leading-relaxed">
            Every purchase held in escrow — funds release only after you confirm delivery with a
            6-digit code.
          </p>
        </div>
      </div>

      <div className="flex gap-3 mt-8">
        <Button
          onClick={onBack}
          variant="outline"
          className="flex-1 h-12 rounded-2xl border-white/10 bg-white/5 text-white hover:bg-white/10"
        >
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <Button
          onClick={onNext}
          className="flex-[2] h-12 bg-[#22C55E] hover:bg-[#16A34A] text-black font-semibold rounded-2xl"
        >
          Continue
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// STEP 3 — Phone Verification
// ─────────────────────────────────────────────────────────────────

function Step3({
  email,
  otp,
  otpRefs,
  onOtpChange,
  onOtpKeyDown,
  onOtpPaste,
  termsChecked,
  onTermsChange,
  canSubmit,
  submitting,
  onSubmit,
  onBack,
}: {
  email: string;
  otp: string[];
  otpRefs: React.MutableRefObject<(HTMLInputElement | null)[]>;
  onOtpChange: (index: number, value: string) => void;
  onOtpKeyDown: (index: number, e: React.KeyboardEvent<HTMLInputElement>) => void;
  onOtpPaste: (e: React.ClipboardEvent<HTMLInputElement>) => void;
  termsChecked: boolean;
  onTermsChange: (v: boolean) => void;
  canSubmit: boolean;
  submitting: boolean;
  onSubmit: () => void;
  onBack: () => void;
}) {
  return (
    <div>
      <div className="mb-6">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-white/60 mb-3">
          <Phone className="h-3 w-3" /> Step 3 of 3
        </div>
        <h1 className="text-2xl font-bold">Phone Verification</h1>
        <p className="text-sm text-white/50 mt-1">Enter the 6-digit code sent to your phone</p>
      </div>

      {/* Test-mode notice — SMS verification is simulated for now */}
      <div className="mb-5 flex items-start gap-2 rounded-xl border border-[#F59E0B]/30 bg-[#F59E0B]/10 px-3 py-2 text-[11px] text-[#FCD34D]">
        <FlaskConical className="mt-px h-3.5 w-3.5 shrink-0" />
        <span>
          <strong>Test mode:</strong> SMS verification isn't live yet — enter any 6 digits to
          continue.
        </span>
      </div>

      {/* OTP boxes */}
      <div className="flex gap-2 justify-center mb-6">
        {otp.map((digit, i) => (
          <input
            key={i}
            ref={(el) => {
              otpRefs.current[i] = el;
            }}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={digit}
            onChange={(e) => onOtpChange(i, e.target.value)}
            onKeyDown={(e) => onOtpKeyDown(i, e)}
            onPaste={i === 0 ? onOtpPaste : undefined}
            className={`w-12 h-14 text-center text-xl font-bold rounded-xl border bg-white/5 text-white outline-none transition-all caret-transparent ${
              digit ? "border-[#22C55E] bg-[#22C55E]/10" : "border-white/10 focus:border-white/30"
            }`}
          />
        ))}
      </div>

      {/* Resend link */}
      <p className="text-center text-xs text-white/40 mb-5">
        Didn't receive a code?{" "}
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[#22C55E] hover:underline"
          onClick={() => toast.info("Code resent to your phone")}
        >
          <RotateCcw className="h-3 w-3" /> Resend code
        </button>
      </p>

      {/* Single checkbox */}
      <div className="mb-6">
        <label className="flex items-start gap-3 cursor-pointer">
          <Checkbox
            checked={termsChecked}
            onCheckedChange={(c) => onTermsChange(c === true)}
            className="mt-0.5 border-white/20 data-[state=checked]:bg-[#22C55E] data-[state=checked]:border-[#22C55E]"
          />
          <span className="text-sm text-white/70 leading-snug">
            I agree to the <span className="text-[#22C55E]">Terms of Service</span>,{" "}
            <span className="text-[#22C55E]">Buyer Protection Policy</span> &amp;{" "}
            <span className="text-[#22C55E]">Refund Policy</span>.
          </span>
        </label>
      </div>

      <div className="flex gap-3">
        <Button
          onClick={onBack}
          variant="outline"
          className="flex-1 h-12 rounded-2xl border-white/10 bg-white/5 text-white hover:bg-white/10"
        >
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <Button
          onClick={onSubmit}
          disabled={!canSubmit}
          className="flex-[2] h-12 bg-[#22C55E] hover:bg-[#16A34A] text-black font-semibold rounded-2xl disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Create Buyer Account"}
        </Button>
      </div>

      <p className="text-center text-xs text-white/30 mt-3">Registered to {email}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// STEP 4 — Success
// ─────────────────────────────────────────────────────────────────

const BUYER_BENEFITS = [
  { Icon: Shield, text: "Escrow-protected purchases on every order" },
  { Icon: Leaf, text: "Shop from verified farms across the US" },
  { Icon: Lock, text: "Funds only release after you confirm delivery" },
  { Icon: Phone, text: "Real-time order updates & buyer support" },
];

function Step4({ firstName, onBrowse }: { firstName: string; onBrowse: () => void }) {
  return (
    <div className="text-center">
      <div className="w-20 h-20 rounded-full bg-[#22C55E]/15 flex items-center justify-center mx-auto mb-5">
        <CheckCircle2 className="h-10 w-10 text-[#22C55E]" />
      </div>

      <h1 className="text-2xl font-bold mb-1">You're In! ✅</h1>
      <p className="text-white/60 text-sm mb-8">
        Welcome, <span className="text-white font-semibold">{firstName}</span>! Your buyer account
        is ready to use.
      </p>

      <div className="text-left space-y-3 mb-8">
        {BUYER_BENEFITS.map(({ Icon, text }) => (
          <div
            key={text}
            className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/5 p-4"
          >
            <div className="w-8 h-8 rounded-full bg-[#22C55E]/20 flex items-center justify-center shrink-0">
              <Icon className="h-4 w-4 text-[#22C55E]" />
            </div>
            <p className="text-sm text-white/80">{text}</p>
          </div>
        ))}
      </div>

      <Button
        onClick={onBrowse}
        className="w-full h-12 bg-[#22C55E] hover:bg-[#16A34A] text-black font-semibold rounded-2xl"
      >
        Browse the Marketplace
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// SHARED PRIMITIVES
// ─────────────────────────────────────────────────────────────────

function FormField({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold text-white/60 uppercase tracking-wide">{label}</Label>
      {children}
      {error && <p className="text-xs font-medium text-red-400">{error}</p>}
    </div>
  );
}
