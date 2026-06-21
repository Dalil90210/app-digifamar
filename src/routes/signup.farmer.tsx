import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { z } from "zod";
import { toast } from "sonner";
import {
  Tractor,
  Eye,
  EyeOff,
  CheckCircle2,
  Loader2,
  ArrowLeft,
  Shield,
  Clock,
  Phone,
  Star,
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
import { geocodeAddress } from "@/lib/geocode.functions";

export const Route = createFileRoute("/signup/farmer")({
  head: () => ({
    meta: [
      { title: "Farmer Registration — DiGiFaMaR" },
      {
        name: "description",
        content:
          "Register as a farmer on DiGiFaMaR. Sell direct to buyers and keep 92% of every sale.",
      },
    ],
  }),
  component: FarmerSignup,
});

// ─────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────

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

const FARM_TYPES = [
  "Vegetables & Produce",
  "Fruits & Orchards",
  "Grains & Cereals",
  "Livestock & Cattle",
  "Poultry",
  "Dairy",
  "Organic Farm",
  "Greenhouse/Hydroponic",
  "Mixed",
  "Other",
];

// ─────────────────────────────────────────────────────────────────
// VALIDATION SCHEMAS
// ─────────────────────────────────────────────────────────────────

const step1Schema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(60),
  lastName: z.string().trim().min(1, "Last name is required").max(60),
  email: z.string().trim().email("Enter a valid email address").max(255),
  phone: z
    .string()
    .trim()
    .refine((v) => isValidPhone(v), {
      message: "Enter a valid US phone number, e.g. (555) 123-4567",
    }),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
});

const step2Schema = z.object({
  farmName: z.string().trim().min(2, "Farm name is required").max(120),
  address: z.string().trim().min(3, "Street address is required").max(200),
  city: z.string().trim().min(2, "City is required").max(100),
  state: z.string().min(2, "Please select a state"),
  zip: z
    .string()
    .trim()
    .regex(/^\d{5}(-\d{4})?$/u, "Enter a valid US ZIP code"),
  farmType: z.string().min(1, "Please select a farm type"),
  acreage: z.string().optional(),
  yearsActive: z.coerce
    .number({ invalid_type_error: "Enter a number" })
    .min(0, "Cannot be negative")
    .max(150, "Enter a realistic value"),
  usdaNumber: z.string().optional(),
});

type Step1Data = z.infer<typeof step1Schema>;
type Step2Data = z.infer<typeof step2Schema>;
type Step1Errors = Partial<Record<keyof Step1Data, string>>;
type Step2Errors = Partial<Record<keyof Step2Data, string>>;

// ─────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────

const formatPhone = formatUSInput;

// ─────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────

function FarmerSignup() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);

  // Step 1 data
  const [step1, setStep1] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    password: "",
  });
  const [step1Errors, setStep1Errors] = useState<Step1Errors>({});
  const [showPassword, setShowPassword] = useState(false);

  // Step 2 data
  const [step2, setStep2] = useState({
    farmName: "",
    address: "",
    city: "",
    state: "",
    zip: "",
    farmType: "",
    acreage: "",
    yearsActive: "",
    usdaNumber: "",
  });
  const [step2Errors, setStep2Errors] = useState<Step2Errors>({});

  // Step 3 data
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [termsChecked, setTermsChecked] = useState(false);
  const [escrowChecked, setEscrowChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  const otpComplete = otp.every((d) => d.length === 1);
  const canSubmit = otpComplete && termsChecked && escrowChecked && !submitting;

  const updateStep1 = <K extends keyof typeof step1>(key: K, value: (typeof step1)[K]) => {
    setStep1((p) => ({ ...p, [key]: value }));
    setStep1Errors((e) => ({ ...e, [key]: undefined }));
  };

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
    const result = step1Schema.safeParse(step1);
    if (!result.success) {
      const errs: Step1Errors = {};
      for (const issue of result.error.issues) {
        const k = issue.path[0] as keyof Step1Data;
        if (!errs[k]) errs[k] = issue.message;
      }
      setStep1Errors(errs);
      return false;
    }
    setStep1Errors({});
    return true;
  };

  const validateStep2 = () => {
    const result = step2Schema.safeParse({
      ...step2,
      yearsActive: step2.yearsActive === "" ? undefined : step2.yearsActive,
    });
    if (!result.success) {
      const errs: Step2Errors = {};
      for (const issue of result.error.issues) {
        const k = issue.path[0] as keyof Step2Data;
        if (!errs[k]) errs[k] = issue.message;
      }
      setStep2Errors(errs);
      return false;
    }
    setStep2Errors({});
    return true;
  };

  const handleNext = () => {
    if (step === 1 && !validateStep1()) {
      toast.error("Please fix the highlighted fields");
      return;
    }
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
      // Geocode the farm location BEFORE creating the account so buyers can
      // discover the farm by distance on /browse.
      let coords: { lat: number | null; lng: number | null } = {
        lat: null,
        lng: null,
      };
      try {
        const geo = await geocodeAddress({
          data: {
            address: step2.address,
            city: step2.city,
            state: step2.state,
            zip: step2.zip,
            country: "USA",
          },
        });
        if (geo) coords = { lat: geo.lat, lng: geo.lng };
      } catch {
        // Non-fatal: profile still created without coordinates.
      }

      const { data, error } = await supabase.auth.signUp({
        email: step1.email,
        password: step1.password,
        options: {
          data: {
            full_name: `${step1.firstName} ${step1.lastName}`,
            phone: normalizeToE164(step1.phone) ?? step1.phone,
            // Role is assigned server-side by the handle_new_user() trigger from
            // this metadata (client-side user_roles writes are revoked by RLS).
            role: "farmer",
          },
        },
      });
      if (error) throw error;

      const userId = data.user?.id;
      if (!userId) throw new Error("Signup failed — please try again.");

      // Store farmer profile data (types not regenerated yet for new cols).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const profileInsert: any = {
        user_id: userId,
        farm_name: step2.farmName,
        address: step2.address,
        city: step2.city,
        state: step2.state,
        zip: step2.zip,
        lat: coords.lat,
        lng: coords.lng,
        acres: step2.acreage ? parseFloat(step2.acreage) : null,
        years_farming: step2.yearsActive ? parseInt(step2.yearsActive) : null,
        verification_status: "pending",
        farm_type: step2.farmType,
        usda_number: step2.usdaNumber || null,
      };
      await supabase.from("farmer_profiles").insert(profileInsert);

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
          <Step1
            data={step1}
            errors={step1Errors}
            showPassword={showPassword}
            onTogglePassword={() => setShowPassword((v) => !v)}
            onUpdate={updateStep1}
            onNext={handleNext}
          />
        )}
        {step === 2 && (
          <Step2
            data={step2}
            errors={step2Errors}
            onUpdate={updateStep2}
            onNext={handleNext}
            onBack={() => setStep(1)}
          />
        )}
        {step === 3 && (
          <Step3
            email={step1.email}
            otp={otp}
            otpRefs={otpRefs}
            onOtpChange={handleOtpChange}
            onOtpKeyDown={handleOtpKeyDown}
            onOtpPaste={handleOtpPaste}
            termsChecked={termsChecked}
            escrowChecked={escrowChecked}
            onTermsChange={setTermsChecked}
            onEscrowChange={setEscrowChecked}
            canSubmit={canSubmit}
            submitting={submitting}
            onSubmit={handleSubmit}
            onBack={() => setStep(2)}
          />
        )}
        {step === 4 && (
          <Step4
            farmName={step2.farmName}
            email={step1.email}
            onGoToSignIn={() => navigate({ to: "/auth", search: { tab: "signin" } })}
          />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// STEP INDICATOR
// ─────────────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: number }) {
  const labels = ["Personal Info", "Farm Details", "Verify"];
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
// STEP 1 — Personal Info
// ─────────────────────────────────────────────────────────────────

function Step1({
  data,
  errors,
  showPassword,
  onTogglePassword,
  onUpdate,
  onNext,
}: {
  data: { firstName: string; lastName: string; email: string; phone: string; password: string };
  errors: Step1Errors;
  showPassword: boolean;
  onTogglePassword: () => void;
  onUpdate: <K extends "firstName" | "lastName" | "email" | "phone" | "password">(
    key: K,
    value: string,
  ) => void;
  onNext: () => void;
}) {
  return (
    <div>
      <div className="mb-6">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-white/60 mb-3">
          <Tractor className="h-3 w-3" /> Step 1 of 3
        </div>
        <h1 className="text-2xl font-bold">Personal Information</h1>
        <p className="text-sm text-white/50 mt-1">Tell us about yourself</p>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <FormField label="First Name" error={errors.firstName}>
            <Input
              value={data.firstName}
              onChange={(e) => onUpdate("firstName", e.target.value)}
              placeholder="John"
              autoComplete="given-name"
              maxLength={60}
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-[#22C55E] focus:ring-[#22C55E]/20"
            />
          </FormField>
          <FormField label="Last Name" error={errors.lastName}>
            <Input
              value={data.lastName}
              onChange={(e) => onUpdate("lastName", e.target.value)}
              placeholder="Smith"
              autoComplete="family-name"
              maxLength={60}
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-[#22C55E] focus:ring-[#22C55E]/20"
            />
          </FormField>
        </div>

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
      </div>

      <Button
        onClick={onNext}
        className="w-full mt-8 bg-[#22C55E] hover:bg-[#16A34A] text-black font-semibold h-12 rounded-2xl"
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
// STEP 2 — Farm Details
// ─────────────────────────────────────────────────────────────────

function Step2({
  data,
  errors,
  onUpdate,
  onNext,
  onBack,
}: {
  data: {
    farmName: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    farmType: string;
    acreage: string;
    yearsActive: string;
    usdaNumber: string;
  };
  errors: Step2Errors;
  onUpdate: <
    K extends
      | "farmName"
      | "address"
      | "city"
      | "state"
      | "zip"
      | "farmType"
      | "acreage"
      | "yearsActive"
      | "usdaNumber",
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
          <Tractor className="h-3 w-3" /> Step 2 of 3
        </div>
        <h1 className="text-2xl font-bold">Farm Details</h1>
        <p className="text-sm text-white/50 mt-1">Tell buyers about your farm</p>
      </div>

      <div className="space-y-4">
        <FormField label="Farm Name" error={errors.farmName}>
          <Input
            value={data.farmName}
            onChange={(e) => onUpdate("farmName", e.target.value)}
            placeholder="Green Acres Family Farm"
            maxLength={120}
            className="bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-[#22C55E] focus:ring-[#22C55E]/20"
          />
        </FormField>

        <FormField label="Street Address" error={errors.address}>
          <Input
            value={data.address}
            onChange={(e) => onUpdate("address", e.target.value)}
            placeholder="1234 County Road"
            autoComplete="street-address"
            maxLength={200}
            className="bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-[#22C55E] focus:ring-[#22C55E]/20"
          />
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="City" error={errors.city}>
            <Input
              value={data.city}
              onChange={(e) => onUpdate("city", e.target.value)}
              placeholder="Fresno"
              autoComplete="address-level2"
              maxLength={100}
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-[#22C55E] focus:ring-[#22C55E]/20"
            />
          </FormField>
          <FormField label="ZIP Code" error={errors.zip}>
            <Input
              value={data.zip}
              onChange={(e) => onUpdate("zip", e.target.value)}
              placeholder="93721"
              autoComplete="postal-code"
              inputMode="numeric"
              maxLength={10}
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-[#22C55E] focus:ring-[#22C55E]/20"
            />
          </FormField>
        </div>

        <FormField label="State" error={errors.state}>
          <Select value={data.state} onValueChange={(v) => onUpdate("state", v)}>
            <SelectTrigger className="bg-white/5 border-white/10 text-white focus:ring-[#22C55E]/20">
              <SelectValue placeholder="Select your state" />
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

        <FormField label="Farm Type" error={errors.farmType}>
          <Select value={data.farmType} onValueChange={(v) => onUpdate("farmType", v)}>
            <SelectTrigger className="bg-white/5 border-white/10 text-white focus:ring-[#22C55E]/20">
              <SelectValue placeholder="Select farm type" />
            </SelectTrigger>
            <SelectContent className="bg-[#1a2a1a] border-white/10">
              {FARM_TYPES.map((t) => (
                <SelectItem
                  key={t}
                  value={t}
                  className="text-white focus:bg-white/10 focus:text-white"
                >
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Acreage (optional)" error={errors.acreage}>
            <Input
              type="number"
              min={0}
              value={data.acreage}
              onChange={(e) => onUpdate("acreage", e.target.value)}
              placeholder="e.g. 50"
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-[#22C55E] focus:ring-[#22C55E]/20"
            />
          </FormField>
          <FormField label="Years Farming" error={errors.yearsActive}>
            <Input
              type="number"
              min={0}
              max={150}
              value={data.yearsActive}
              onChange={(e) => onUpdate("yearsActive", e.target.value)}
              placeholder="e.g. 12"
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-[#22C55E] focus:ring-[#22C55E]/20"
            />
          </FormField>
        </div>

        <FormField label="USDA Farm Number (optional)" error={errors.usdaNumber}>
          <Input
            value={data.usdaNumber}
            onChange={(e) => onUpdate("usdaNumber", e.target.value)}
            placeholder="e.g. 1234567"
            maxLength={20}
            className="bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-[#22C55E] focus:ring-[#22C55E]/20"
          />
        </FormField>
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

const VERIFICATION_ITEMS = [
  { icon: Phone, text: "Phone number linked to your account" },
  { icon: Shield, text: "Farm location validated against USDA records" },
  { icon: Star, text: "Identity verified for buyer trust" },
  { icon: Clock, text: "Review completed within 24–48 hours" },
];

function Step3({
  email,
  otp,
  otpRefs,
  onOtpChange,
  onOtpKeyDown,
  onOtpPaste,
  termsChecked,
  escrowChecked,
  onTermsChange,
  onEscrowChange,
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
  escrowChecked: boolean;
  onTermsChange: (v: boolean) => void;
  onEscrowChange: (v: boolean) => void;
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

      {/* Verification checklist */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 mb-5 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-white/40 mb-1">
          Verification includes
        </p>
        {VERIFICATION_ITEMS.map(({ icon: Icon, text }) => (
          <div key={text} className="flex items-center gap-3 text-sm text-white/70">
            <div className="w-6 h-6 rounded-full bg-[#22C55E]/15 flex items-center justify-center shrink-0">
              <Icon className="h-3 w-3 text-[#22C55E]" />
            </div>
            {text}
          </div>
        ))}
      </div>

      {/* Required checkboxes */}
      <div className="space-y-3 mb-6">
        <label className="flex items-start gap-3 cursor-pointer">
          <Checkbox
            checked={termsChecked}
            onCheckedChange={(c) => onTermsChange(c === true)}
            className="mt-0.5 border-white/20 data-[state=checked]:bg-[#22C55E] data-[state=checked]:border-[#22C55E]"
          />
          <span className="text-sm text-white/70 leading-snug">
            I agree to the <span className="text-[#22C55E]">Terms of Service</span> and{" "}
            <span className="text-[#22C55E]">Farmer Agreement</span>, including product listing
            standards and platform commission rates.
          </span>
        </label>

        <label className="flex items-start gap-3 cursor-pointer">
          <Checkbox
            checked={escrowChecked}
            onCheckedChange={(c) => onEscrowChange(c === true)}
            className="mt-0.5 border-white/20 data-[state=checked]:bg-[#22C55E] data-[state=checked]:border-[#22C55E]"
          />
          <span className="text-sm text-white/70 leading-snug">
            I understand the <span className="text-[#22C55E]">Escrow Release Process</span> — funds
            are held until buyers confirm receipt and are released within 48 hours of delivery.
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
          {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Complete Registration"}
        </Button>
      </div>

      <p className="text-center text-xs text-white/30 mt-3">Registered to {email}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// STEP 4 — Success
// ─────────────────────────────────────────────────────────────────

const NEXT_STEPS = [
  {
    n: "1",
    title: "Application Review",
    body: "Our team reviews your farm details within 24–48 hours.",
  },
  {
    n: "2",
    title: "Verification Call",
    body: "We'll call you to confirm your farm location and produce.",
  },
  {
    n: "3",
    title: "Profile Goes Live",
    body: "Your farm listing becomes visible to buyers across the platform.",
  },
  {
    n: "4",
    title: "Start Receiving Orders",
    body: "Accept orders, set your prices, and keep up to 92% of every sale.",
  },
];

function Step4({
  farmName,
  email,
  onGoToSignIn,
}: {
  farmName: string;
  email: string;
  onGoToSignIn: () => void;
}) {
  return (
    <div className="text-center">
      <div className="w-20 h-20 rounded-full bg-[#22C55E]/15 flex items-center justify-center mx-auto mb-5">
        <CheckCircle2 className="h-10 w-10 text-[#22C55E]" />
      </div>

      <h1 className="text-2xl font-bold mb-1">You're registered!</h1>
      <p className="text-white/50 text-sm mb-2">
        <span className="text-white font-medium">{farmName}</span> is now in review
      </p>
      <p className="text-white/40 text-xs mb-8">
        Confirmation sent to <span className="text-white/60">{email}</span>
      </p>

      <div className="text-left space-y-3 mb-8">
        {NEXT_STEPS.map(({ n, title, body }) => (
          <div
            key={n}
            className="flex items-start gap-4 rounded-2xl border border-white/10 bg-white/5 p-4"
          >
            <div className="w-8 h-8 rounded-full bg-[#22C55E]/20 flex items-center justify-center shrink-0 font-bold text-[#22C55E] text-sm">
              {n}
            </div>
            <div>
              <p className="font-semibold text-sm">{title}</p>
              <p className="text-xs text-white/50 mt-0.5">{body}</p>
            </div>
          </div>
        ))}
      </div>

      <Button
        onClick={onGoToSignIn}
        className="w-full h-12 bg-[#22C55E] hover:bg-[#16A34A] text-black font-semibold rounded-2xl"
      >
        Go to Sign In
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
