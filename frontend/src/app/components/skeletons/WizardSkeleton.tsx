"use client";

import { Skeleton } from "../ui/Skeleton";
import { Card, CardContent } from "../ui/Card";

export function WizardSkeleton() {
  return (
    <div className="space-y-8 animate-pulse">
      {/* Stepper Skeleton */}
      <div className="flex items-center justify-between px-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex flex-col items-center space-y-2">
            <Skeleton className="h-10 w-10 rounded-full" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>

      {/* Form Panel Skeleton */}
      <Card>
        <CardContent className="space-y-6 p-8">
          <div className="space-y-2">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-12 w-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-10 w-full" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-10 w-full" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-10 w-full" />
            </div>
          </div>
          <div className="flex justify-end pt-4">
            <Skeleton className="h-11 w-32 rounded-lg" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
