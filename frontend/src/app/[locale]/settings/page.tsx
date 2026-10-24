"use client";

import { useEffect, useState, useTransition, type ChangeEvent, type KeyboardEvent } from "react";
import { useLocale } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import {
  User,
  Wallet,
  Bell,
  Shield,
  Monitor,
  Crown,
  LogOut,
  Key,
  CheckCheck,
  Copy,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { useLogout } from "../../hooks/useLogout";
import { GamificationSettings } from "../../components/gamification/GamificationSettings";
import { useThemeStore } from "../../stores/useThemeStore";
import {
  useWalletStore,
  selectWalletAddress,
  selectWalletNetwork,
} from "../../stores/useWalletStore";
import { useUserStore, selectUser } from "../../stores/useUserStore";
import { logoutUser } from "../../lib/session";
import { useNotificationPreferences, useUpdateNotificationPreferences } from "../../hooks/useApi";
import { COPY_FEEDBACK_RESET_MS } from "../../components/ui";
// ─── Types ────────────────────────────────────────────────────────────────────

interface NotificationPrefs {
  loanApproved: boolean;
  repaymentDue: boolean;
  repaymentConfirmed: boolean;
  loanDefaulted: boolean;
  scoreChanged: boolean;
  email: boolean;
  sms: boolean;
  inApp: boolean;
  phone: string;
}

// ─── Section navigation ───────────────────────────────────────────────────────

const SECTIONS = [
  { id: "profile", label: "Profile", icon: User },
  { id: "wallet", label: "Wallet", icon: Wallet },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "security", label: "Security", icon: Shield },
  { id: "display", label: "Display", icon: Monitor },
  { id: "gamification", label: "Gamification", icon: Crown },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

function settingsTabId(id: SectionId) {
  return `settings-tab-${id}`;
}

function settingsPanelId(id: SectionId) {
  return `settings-panel-${id}`;
}

// ─── Copy-to-clipboard helper ─────────────────────────────────────────────────

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), COPY_FEEDBACK_RESET_MS);
    });
  };

  return (
    <button
      onClick={handleCopy}
      className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 dark:hover:text-zinc-200 dark:hover:bg-zinc-800 transition-colors"
      title="Copy to clipboard"
      aria-label={copied ? "Copied to clipboard" : "Copy to clipboard"}
    >
      {copied ? <CheckCheck className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
    </button>
  );
}

// ─── Toggle switch ─────────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <div className="flex items-center justify-between py-3">
      <div>
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{label}</p>
        {description && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{description}</p>
        )}
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
          checked ? "bg-indigo-600" : "bg-zinc-300 dark:bg-zinc-700"
        }`}
        role="switch"
        aria-checked={checked}
        aria-label={label}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}

// ─── Profile section ──────────────────────────────────────────────────────────

function ProfileSection() {
  const user = useUserStore(selectUser);
  const [displayName, setDisplayName] = useState(user?.id ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    // In real impl: call PATCH /api/user/profile
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          Manage your public display name and contact info.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Avatar */}
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 rounded-full bg-indigo-100 dark:bg-indigo-500/20 flex items-center justify-center">
            <User className="h-8 w-8 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Profile Picture</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Avatars are not supported yet — coming soon.
            </p>
          </div>
        </div>

        <Input
          label="Display Name"
          placeholder="e.g. Alice"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
        />
        <Input
          label="Email (optional)"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          helperText="Used for email notifications only. Never shared publicly."
        />

        <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-2">
          <span className="text-red-600">*</span> Required field
        </p>

        <Button variant="primary" onClick={handleSave} className="w-full sm:w-auto">
          {saved ? "Saved!" : "Save Profile"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Wallet section ───────────────────────────────────────────────────────────

function WalletSection() {
  const address = useWalletStore(selectWalletAddress);
  const network = useWalletStore(selectWalletNetwork);
  const disconnect = useWalletStore((s) => s.disconnect);
  const { logout } = useLogout();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Wallet</CardTitle>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          Your connected Stellar wallet and network settings.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {address ? (
          <>
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
                Connected Address
              </p>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-mono text-zinc-900 dark:text-zinc-50 break-all">
                  {address}
                </span>
                <CopyButton value={address} />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Network</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {network?.name ?? "Unknown"}
                </p>
              </div>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                  network?.isSupported
                    ? "bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400"
                    : "bg-yellow-50 text-yellow-700 dark:bg-yellow-500/10 dark:text-yellow-400"
                }`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                {network?.isSupported ? "Supported" : "Unsupported"}
              </span>
            </div>

            <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800 flex flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                onClick={() => disconnect()}
                leftIcon={<LogOut className="h-4 w-4" />}
                className="text-amber-600 border-amber-200 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-900/50 dark:hover:bg-amber-950/20"
              >
                Disconnect Wallet
              </Button>
              <Button
                variant="outline"
                onClick={() => logout()}
                leftIcon={<LogOut className="h-4 w-4" />}
                className="text-red-600 border-red-200 hover:bg-red-50 dark:text-red-400 dark:border-red-900/50 dark:hover:bg-red-950/20"
              >
                Sign Out
              </Button>
            </div>
          </>
        ) : (
          <div className="text-center py-6">
            <Wallet className="h-10 w-10 text-zinc-300 dark:text-zinc-600 mx-auto mb-3" />
            <p className="text-sm text-zinc-500 dark:text-zinc-400">No wallet connected.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Notifications section ────────────────────────────────────────────────────

function NotificationsSection() {
  const { data, isLoading, error } = useNotificationPreferences();
  const updateNotificationPreferences = useUpdateNotificationPreferences();
  const [prefs, setPrefs] = useState<NotificationPrefs>({
    loanApproved: true,
    repaymentDue: true,
    repaymentConfirmed: true,
    loanDefaulted: true,
    scoreChanged: false,
    email: false,
    sms: false,
    inApp: true,
    phone: "",
  });
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;

    // Sync server-fetched preferences into local editable form state once the
    // query resolves. This is the intended pattern here, not a render-loop.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrefs((current) => ({
      ...current,
      email: data.emailEnabled,
      sms: data.smsEnabled,
      phone: data.phone ?? "",
    }));
    // Reset save feedback when fresh server preferences replace the editable form state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSaveError(null);
    // Reset save confirmation when fresh server preferences replace the editable form state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSaved(false);
  }, [data]);

  const toggle = (key: keyof NotificationPrefs) => setPrefs((p) => ({ ...p, [key]: !p[key] }));

  const perTypeOverrides = {
    loan_approved: prefs.loanApproved,
    repayment_due: prefs.repaymentDue,
    repayment_confirmed: prefs.repaymentConfirmed,
    loan_defaulted: prefs.loanDefaulted,
    score_changed: prefs.scoreChanged,
  };

  const handleSave = () => {
    setSaveError(null);
    setPhoneError(null);

    const phone = prefs.phone.trim();

    if (prefs.sms) {
      if (!phone) {
        setPhoneError("A phone number is required for SMS notifications.");
        return;
      }

      // Basic international phone validation
      const phoneRegex = /^\+?[1-9]\d{7,14}$/;

      if (!phoneRegex.test(phone)) {
        setPhoneError("Please enter a valid phone number.");
        return;
      }
    }

    updateNotificationPreferences.mutate(
      {
        emailEnabled: prefs.email,
        smsEnabled: prefs.sms,
        phone: phone || null,
        perTypeOverrides,
      },
      {
        onSuccess: () => {
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
        },
        onError: (error) => {
          setSaveError(error.message);
        },
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          Choose which events you want to be notified about and how.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 pb-2">
            Delivery
          </p>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            <Toggle
              checked={prefs.inApp}
              onChange={() => toggle("inApp")}
              label="In-App Notifications"
              description="Show notifications inside RemitLend"
            />
            <Toggle
              checked={prefs.email}
              onChange={() => toggle("email")}
              label="Email Notifications"
              description="Requires a verified email address"
            />
            <Toggle
              checked={prefs.sms}
              onChange={() => {
                setPhoneError(null);
                toggle("sms");
              }}
              label="SMS Notifications"
              description="Requires a verified phone number"
            />
          </div>
          <Input
            label="Phone number"
            placeholder="+14155552671"
            value={prefs.phone}
            onChange={(e) => {
              setPhoneError(null);
              setPrefs((p) => ({ ...p, phone: e.target.value }));
            }}
            helperText={
              prefs.sms
                ? "A phone number is required for SMS notifications."
                : "Optional unless SMS notifications are enabled."
            }
          />
          {phoneError && (
            <p className="mt-1 text-sm text-red-600 dark:text-red-400">{phoneError}</p>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 pb-2 pt-4">
            Events
          </p>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            <Toggle
              checked={prefs.loanApproved}
              onChange={() => toggle("loanApproved")}
              label="Loan Approved"
              description="When your loan application is approved"
            />
            <Toggle
              checked={prefs.repaymentDue}
              onChange={() => toggle("repaymentDue")}
              label="Repayment Due"
              description="Reminder before a payment is due"
            />
            <Toggle
              checked={prefs.repaymentConfirmed}
              onChange={() => toggle("repaymentConfirmed")}
              label="Repayment Confirmed"
              description="When a repayment is recorded on-chain"
            />
            <Toggle
              checked={prefs.loanDefaulted}
              onChange={() => toggle("loanDefaulted")}
              label="Loan Defaulted"
              description="When a loan is marked as defaulted"
            />
            <Toggle
              checked={prefs.scoreChanged}
              onChange={() => toggle("scoreChanged")}
              label="Credit Score Changed"
              description="When your score goes up or down"
            />
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">
            Unable to load notification settings.
          </p>
        )}
        {saveError && <p className="text-sm text-red-600 dark:text-red-400">{saveError}</p>}
        <Button
          variant="primary"
          onClick={handleSave}
          disabled={updateNotificationPreferences.isPending || isLoading}
          className="w-full sm:w-auto"
        >
          {updateNotificationPreferences.isPending
            ? "Saving..."
            : saved
              ? "Saved!"
              : "Save Preferences"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Security section ─────────────────────────────────────────────────────────

function SecuritySection() {
  const user = useUserStore(selectUser);
  const authToken = useUserStore((s) => s.authToken);
  const [showToken, setShowToken] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Security</CardTitle>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          Session management and developer API access.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Session */}
        <div>
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
            Active Session
          </p>
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-zinc-500 dark:text-zinc-400">Started</span>
              <span className="text-zinc-900 dark:text-zinc-100 font-medium">
                {user?.sessionStartedAt ? new Date(user.sessionStartedAt).toLocaleString() : "—"}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-zinc-500 dark:text-zinc-400">KYC Status</span>
              <span
                className={`font-medium ${
                  user?.kycVerified
                    ? "text-green-600 dark:text-green-400"
                    : "text-yellow-600 dark:text-yellow-400"
                }`}
              >
                {user?.kycVerified ? "Verified" : "Not Verified"}
              </span>
            </div>
          </div>
        </div>

        {/* API Key */}
        {authToken && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Key className="h-4 w-4 text-zinc-500" />
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  JWT Session Token
                </p>
              </div>
              <button
                onClick={() => setShowToken((v) => !v)}
                className="text-xs font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
                aria-label={showToken ? "Hide session token" : "Show session token"}
              >
                {showToken ? "Hide" : "Show"}
              </button>
            </div>
            <div className="relative rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
              <p className="text-xs font-mono text-zinc-700 dark:text-zinc-300 break-all">
                {showToken ? authToken : `${authToken.slice(0, 20)}${"•".repeat(30)}`}
              </p>
              <div className="absolute right-2 top-2">
                <CopyButton value={authToken} />
              </div>
            </div>
            <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1.5">
              Valid for 24 hours. Keep this secret — it grants full API access.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Display section ──────────────────────────────────────────────────────────

function DisplaySection() {
  const LANGUAGES = [
    { code: "en", label: "English" },
    { code: "es", label: "Español" },
    { code: "tl", label: "Tagalog" },
  ];

  const [isPending, startTransition] = useTransition();
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  const handleLanguageChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextLocale = event.target.value;
    startTransition(() => {
      const segments = pathname.split("/");
      segments[1] = nextLocale;
      router.replace(segments.join("/"));
    });
  };

  const theme = useThemeStore((s) => s.theme);
  const hydrated = useThemeStore((s) => s.hydrated);
  const initializeTheme = useThemeStore((s) => s.initializeTheme);
  const setTheme = useThemeStore((s) => s.setTheme);

  // Ensure client store is initialised
  useEffect(() => {
    if (!hydrated) initializeTheme();
  }, [hydrated, initializeTheme]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Display</CardTitle>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          Appearance and language preferences.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Theme</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Choose a preference: Light / Dark / System
            </p>
          </div>
          <div className="inline-flex items-center gap-2">
            {(["light", "dark", "system"] as const).map((opt) => {
              const active = theme === opt;
              return (
                <button
                  key={opt}
                  onClick={() => setTheme(opt)}
                  className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                    active
                      ? "bg-indigo-600 text-white"
                      : "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200"
                  }`}
                >
                  {opt[0].toUpperCase() + opt.slice(1)}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label
            htmlFor="settings-language-select"
            className="text-sm font-medium text-zinc-900 dark:text-zinc-100 block mb-2"
          >
            Language
          </label>
          <select
            id="settings-language-select"
            value={locale}
            disabled={isPending}
            onChange={handleLanguageChange}
            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-indigo-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState<SectionId>("profile");
  const handleLogout = () => logoutUser("manual");

  const activateSection = (id: SectionId) => {
    setActiveSection(id);
    requestAnimationFrame(() => {
      document.getElementById(settingsTabId(id))?.focus();
    });
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (index + 1) % SECTIONS.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (index - 1 + SECTIONS.length) % SECTIONS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = SECTIONS.length - 1;
    }

    if (nextIndex === null) return;

    event.preventDefault();
    activateSection(SECTIONS[nextIndex].id);
  };

  const renderSection = () => {
    switch (activeSection) {
      case "profile":
        return <ProfileSection />;
      case "wallet":
        return <WalletSection />;
      case "notifications":
        return <NotificationsSection />;
      case "security":
        return <SecuritySection />;
      case "display":
        return <DisplaySection />;
      case "gamification":
        return <GamificationSettings />;
    }
  };

  return (
    <main className="space-y-8 min-h-screen p-8 lg:p-12 max-w-5xl mx-auto">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-widest text-indigo-600">Account</p>
          <h1 className="mt-1 text-3xl font-bold text-zinc-900 dark:text-zinc-50">Settings</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Manage your profile, wallet, notifications, and preferences.
          </p>
        </div>
        <Button
          variant="danger"
          onClick={handleLogout}
          leftIcon={<LogOut className="h-4 w-4" />}
          className="sm:mt-1"
        >
          Log out
        </Button>
      </header>

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Side nav */}
        <nav aria-label="Settings sections" className="lg:w-52 flex-shrink-0">
          <ul
            role="tablist"
            aria-orientation="vertical"
            className="flex flex-row lg:flex-col gap-1 overflow-x-auto lg:overflow-x-visible pb-2 lg:pb-0"
          >
            {SECTIONS.map(({ id, label, icon: Icon }, index) => {
              const isActive = activeSection === id;

              return (
                <li key={id} role="presentation">
                  <button
                    type="button"
                    role="tab"
                    id={settingsTabId(id)}
                    aria-selected={isActive}
                    aria-controls={settingsPanelId(id)}
                    tabIndex={isActive ? 0 : -1}
                    onClick={() => activateSection(id)}
                    onKeyDown={(event) => handleTabKeyDown(event, index)}
                    className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium w-full transition-colors whitespace-nowrap ${
                      isActive
                        ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400"
                        : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
                    }`}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                    {label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Content */}
        <div
          role="tabpanel"
          id={settingsPanelId(activeSection)}
          aria-labelledby={settingsTabId(activeSection)}
          tabIndex={0}
          className="flex-1 min-w-0"
        >
          {renderSection()}
        </div>
      </div>
    </main>
  );
}
