import { motion } from 'motion/react'
import { useAppStore } from '@renderer/stores/appStore'

export function ConnectionStatus() {
  const connectedToExtension = useAppStore((s) => s.connectedToExtension)

  if (connectedToExtension) {
    return (
      <div
        className="flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1"
        title="Connected"
      >
        <motion.span
          className="h-1.5 w-1.5 rounded-full bg-emerald-500"
          animate={{
            scale: [1, 1.3, 1],
            opacity: [1, 0.7, 1]
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: 'easeInOut'
          }}
        />
        {/* Below lg the native window controls leave the top bar too short for the word
            at the minimum window width (e2e/topbar-layout.spec.ts); the dot stays. */}
        <span className="sr-only text-[11px] font-medium text-emerald-400 lg:not-sr-only">
          Connected
        </span>
      </div>
    )
  }

  // HOTFIX: "Waiting for extension" indicator removed while auto-capture is disabled
  return null
}
