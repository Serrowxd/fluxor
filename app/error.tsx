'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { AlertCircle } from 'lucide-react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Application error:', error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-8">
      <AlertCircle className="w-16 h-16 text-red-500 mb-6" />
      <h1 className="text-2xl font-bold mb-2">Application Error</h1>
      <p className="text-gray-600 dark:text-gray-400 mb-6 text-center max-w-md">
        {error.message || 'Something went wrong. Please try again.'}
      </p>
      {error.digest && (
        <p className="text-sm text-gray-500 mb-6 font-mono">
          Error ID: {error.digest}
        </p>
      )}
      <div className="flex gap-4">
        <Button onClick={reset} variant="outline">
          Try again
        </Button>
        <Button onClick={() => window.location.href = '/'}>
          Go home
        </Button>
      </div>
    </div>
  )
}