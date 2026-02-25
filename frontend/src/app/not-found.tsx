import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background text-foreground px-4" aria-labelledby="not-found-title">
      <div className="text-center space-y-6 max-w-md mx-auto">
        {/* Large 404 Text/Icon */}
        <h1 className="text-9xl font-bold text-gray-200 dark:text-gray-800 select-none" aria-hidden="true">404</h1>

        <div className="-mt-16 relative z-10">
          <h2 id="not-found-title" className="text-3xl font-semibold tracking-tight sm:text-4xl text-foreground">
            Page not found
          </h2>
          <p className="mt-4 text-gray-600 dark:text-gray-400 text-lg">
            Sorry, we couldn&apos;t find the page you&apos;re looking for. It might have been removed or renamed.
          </p>
        </div>

        <div className="pt-8">
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-lg bg-foreground text-background px-8 py-3 text-sm font-medium transition-transform hover:scale-105 hover:bg-opacity-90 focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 dark:focus:ring-offset-background"
            aria-label="Return to the home page"
          >
            Return Home
          </Link>
        </div>
      </div>
    </main>
  );
}
