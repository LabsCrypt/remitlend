'use client'

import { useState } from 'react'
import { usePWAInstall } from '@/hooks/usePWAInstall'
import { Download, Wifi, WifiOff, Smartphone, X } from 'lucide-react'

interface PWAInstallPromptProps {
  onClose?: () => void
}

export function PWAInstallPrompt({ onClose }: PWAInstallPromptProps) {
  const { isInstallable, isInstalled, isOnline, install } = usePWAInstall()
  const [isInstalling, setIsInstalling] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  // Don't show if already installed, not installable, or dismissed
  if (isInstalled || !isInstallable || dismissed) {
    return null
  }

  const handleInstall = async () => {
    setIsInstalling(true)
    
    try {
      const success = await install()
      if (success && onClose) {
        onClose()
      }
    } catch (error) {
      console.error('Installation failed:', error)
    } finally {
      setIsInstalling(false)
    }
  }

  const handleDismiss = () => {
    setDismissed(true)
    if (onClose) {
      onClose()
    }
  }

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 z-50 bg-white rounded-lg shadow-lg border border-blue-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <Smartphone className="h-5 w-5 text-blue-600" />
          <h3 className="text-lg font-semibold">Install RemitLend</h3>
        </div>
        <button
          onClick={handleDismiss}
          className="p-1 hover:bg-gray-100 rounded"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      
      <p className="text-sm text-gray-600 mb-3">
        Get the full experience with our mobile app
      </p>
      
      <div className="flex flex-wrap gap-2 mb-3">
        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
          Offline access
        </span>
        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
          Faster loading
        </span>
        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
          Push notifications
        </span>
      </div>
      
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2 text-sm text-gray-600">
          {isOnline ? (
            <>
              <Wifi className="h-4 w-4 text-green-600" />
              <span>Ready to install</span>
            </>
          ) : (
            <>
              <WifiOff className="h-4 w-4 text-red-600" />
              <span>Connect to install</span>
            </>
          )}
        </div>
        
        <button
          onClick={handleInstall}
          disabled={!isOnline || isInstalling}
          className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white px-4 py-2 rounded-md text-sm font-medium flex items-center"
        >
          {isInstalling ? (
            'Installing...'
          ) : (
            <>
              <Download className="h-4 w-4 mr-2" />
              Install
            </>
          )}
        </button>
      </div>
    </div>
  )
}

export function PWAStatusIndicator() {
  const { isInstalled, isOnline } = usePWAInstall()

  return (
    <div className="fixed top-4 right-4 z-40">
      <div className="flex items-center space-x-2 bg-white/90 backdrop-blur-sm rounded-full px-3 py-2 shadow-md">
        {isInstalled && (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
            <Smartphone className="h-3 w-3 mr-1" />
            Installed
          </span>
        )}
        
        <div className="flex items-center space-x-1">
          {isOnline ? (
            <>
              <Wifi className="h-4 w-4 text-green-600" />
              <span className="text-xs text-gray-600">Online</span>
            </>
          ) : (
            <>
              <WifiOff className="h-4 w-4 text-red-600" />
              <span className="text-xs text-gray-600">Offline</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
