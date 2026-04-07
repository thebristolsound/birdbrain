import { Compass, Crosshair, Camera, Tags, FileOutput, Check } from 'lucide-react'
import { motion } from 'motion/react'
import { presets } from '@renderer/lib/motion'

const steps = [
  {
    number: 1,
    delay: 0.7,
    icon: Crosshair,
    bg: 'bg-emerald-950/50 border border-emerald-800/30',
    iconColor: 'text-emerald-400',
    title: 'Add Selectors',
    description:
      'Define regex patterns or entity types to automatically extract from captured pages.'
  },
  {
    number: 2,
    delay: 0.8,
    icon: Camera,
    bg: 'bg-amber-950/50 border border-amber-800/30',
    iconColor: 'text-amber-400',
    title: 'Capture Pages',
    description:
      'Browse the web with our extension. Screenshots, source code, and metadata are saved automatically.'
  },
  {
    number: 3,
    delay: 0.9,
    icon: Tags,
    bg: 'bg-sky-950/50 border border-sky-800/30',
    iconColor: 'text-sky-400',
    title: 'Review & Tag',
    description:
      'Organize captures with tags. Selectors automatically match patterns across your evidence.'
  },
  {
    number: 4,
    delay: 1.0,
    icon: FileOutput,
    bg: 'bg-accent-subtle border border-accent/20',
    iconColor: 'text-accent',
    title: 'Export Reports',
    description:
      'Generate structured intelligence reports with capture timelines, screenshots, and audit trails.'
  }
]

export function QuickStartGuide() {
  return (
    <section className="px-8 pb-16">
      <div className="max-w-5xl mx-auto">
        <motion.div
          className="flex items-center gap-3 mb-6"
          {...presets.fadeUp}
          transition={{ ...presets.fadeUp.transition, delay: 0.7 }}
        >
          <div className="w-7 h-7 rounded-lg bg-accent-subtle border border-accent/20 flex items-center justify-center">
            <Compass className="h-3.5 w-3.5 text-accent" />
          </div>
          <h2 className="font-display font-bold text-lg tracking-tight text-text-primary">
            Quick Start
          </h2>
          <div className="flex-1 h-px bg-border-strong ml-2" />
        </motion.div>

        <div className="grid grid-cols-4 gap-5">
          {steps.map((step) => (
            <motion.div
              key={step.number}
              className="group"
              {...presets.fadeUp}
              transition={{ ...presets.fadeUp.transition, delay: step.delay }}
            >
              <div className="neu-card rounded-2xl p-5 h-full">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 rounded-xl bg-accent flex items-center justify-center text-white font-display font-extrabold text-xs flex-shrink-0 shadow-md shadow-indigo-500/20">
                    {step.number}
                  </div>
                  {step.number < 4 && <div className="flex-1 step-connector" />}
                  {step.number === 4 && (
                    <div className="w-3 h-3 rounded-full bg-accent-subtle flex items-center justify-center flex-shrink-0 ml-auto">
                      <Check className="h-2 w-2 text-accent" />
                    </div>
                  )}
                </div>
                <div
                  className={`w-10 h-10 rounded-xl ${step.bg} flex items-center justify-center mb-3`}
                >
                  <step.icon className={`h-5 w-5 ${step.iconColor}`} />
                </div>
                <h4 className="font-display font-bold text-sm text-text-primary mb-1.5">
                  {step.title}
                </h4>
                <p className="text-[11px] text-text-muted leading-relaxed">{step.description}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
