'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { AlertTriangle } from 'lucide-react'

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Dashboard error:', error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-4rem)] p-8">
      <AlertTriangle className="w-12 h-12 text-yellow-500 mb-4" />
      <h2 className="text-xl font-semibold mb-2">Dashboard Error</h2>
      <p className="text-gray-600 dark:text-gray-400 mb-6 text-center max-w-md">
        We encountered an error loading your dashboard. Your data is safe.
      </p>
      <div className="flex gap-4">
        <Button onClick={reset} size="sm">
          Retry
        </Button>
        <Button onClick={() => window.location.reload()} variant="outline" size="sm">
          Refresh
        </Button>
      </div>
    </div>
  )
}