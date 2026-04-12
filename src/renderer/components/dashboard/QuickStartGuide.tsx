import { Compass, Crosshair, Camera, Tags, FileOutput, Check } from 'lucide-react'
import { Card, CardContent } from '@renderer/components/ui'

const steps = [
  {
    number: 1,
    icon: Crosshair,
    bg: 'bg-emerald-500/10 border border-emerald-500/20',
    iconColor: 'text-emerald-500',
    title: 'Add Selectors',
    description:
      'Define regex patterns or entity types to automatically extract from captured pages.'
  },
  {
    number: 2,
    icon: Camera,
    bg: 'bg-amber-500/10 border border-amber-500/20',
    iconColor: 'text-amber-500',
    title: 'Capture Pages',
    description:
      'Browse the web with our extension. Screenshots, source code, and metadata are saved automatically.'
  },
  {
    number: 3,
    icon: Tags,
    bg: 'bg-sky-500/10 border border-sky-500/20',
    iconColor: 'text-sky-500',
    title: 'Review & Tag',
    description:
      'Organize captures with tags. Selectors automatically match patterns across your evidence.'
  },
  {
    number: 4,
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
        <div className="flex items-center gap-3 mb-6">
          <div className="w-7 h-7 rounded-lg bg-accent-subtle border border-accent/20 flex items-center justify-center">
            <Compass className="h-3.5 w-3.5 text-accent" />
          </div>
          <h2 className="font-display font-bold text-lg tracking-tight text-text-primary">
            Quick Start
          </h2>
          <div className="flex-1 h-px bg-border-strong ml-2" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {steps.map((step) => (
            <div key={step.number} className="group">
              <Card className="h-full">
                <CardContent>
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
                </CardContent>
              </Card>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
