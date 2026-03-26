import Link from "next/link";
import { Settings, BarChart3, Crown, HelpCircle, LogOut, ChevronRight } from "lucide-react";
import { ErrorBoundary } from "../components/global_ui/ErrorBoundary";

const moreItems = [
  {
    title: "Analytics",
    description: "View detailed analytics and reports",
    href: "/analytics",
    icon: BarChart3,
  },
  {
    title: "Kingdom",
    description: "Access kingdom features",
    href: "/kingdom",
    icon: Crown,
  },
  {
    title: "Settings",
    description: "Manage your account settings",
    href: "/settings",
    icon: Settings,
  },
  {
    title: "Help & Support",
    description: "Get help and contact support",
    href: "/help",
    icon: HelpCircle,
  },
];

export default function MorePage() {
  return (
    <section className="space-y-6 pb-20 md:pb-0">
      <header>
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">
          More Options
        </p>
        <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">More</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
          Access additional features and settings.
        </p>
      </header>

      <ErrorBoundary scope="more options" variant="section">
        <div className="space-y-2">
          {moreItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-4 p-4 rounded-xl border border-zinc-200 bg-white hover:bg-zinc-50 transition-colors dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
            >
              <div className="rounded-lg bg-zinc-50 p-2 dark:bg-zinc-900">
                <item.icon className="h-5 w-5 text-zinc-600 dark:text-zinc-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">
                  {item.title}
                </h3>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 truncate">
                  {item.description}
                </p>
              </div>
              <ChevronRight className="h-5 w-5 text-zinc-400" />
            </Link>
          ))}
          
          <button className="w-full flex items-center gap-4 p-4 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 transition-colors dark:border-red-800/50 dark:bg-red-950/20 dark:hover:bg-red-950/30">
            <div className="rounded-lg bg-red-100 p-2 dark:bg-red-900/50">
              <LogOut className="h-5 w-5 text-red-600 dark:text-red-400" />
            </div>
            <div className="flex-1 text-left">
              <h3 className="font-semibold text-red-900 dark:text-red-300">
                Sign Out
              </h3>
              <p className="text-sm text-red-600 dark:text-red-400">
                Sign out of your account
              </p>
            </div>
          </button>
        </div>
      </ErrorBoundary>
    </section>
  );
}
