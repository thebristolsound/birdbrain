import { Compass, Crosshair, Camera, Brain, FileOutput, Check } from 'lucide-react'

const steps = [
  {
    number: 1,
    delay: 'd7',
    icon: Crosshair,
    bg: 'bg-emerald-950/50 border border-emerald-800/30',
    iconColor: 'text-emerald-400',
    title: 'Add Selectors',
    description:
      'Define regex patterns or entity types to automatically extract from captured pages.',
  },
  {
    number: 2,
    delay: 'd8',
    icon: Camera,
    bg: 'bg-amber-950/50 border border-amber-800/30',
    iconColor: 'text-amber-400',
    title: 'Capture Pages',
    description:
      'Browse the web with our extension. Screenshots, source code, and metadata are saved automatically.',
  },
  {
    number: 3,
    delay: 'd9',
    icon: Brain,
    bg: 'bg-sky-950/50 border border-sky-800/30',
    iconColor: 'text-sky-400',
    title: 'Analyze Entities',
    description:
      'AI-powered entity extraction builds relationship graphs and identifies clusters automatically.',
  },
  {
    number: 4,
    delay: 'd9',
    icon: FileOutput,
    bg: 'bg-indigo-950/50 border border-indigo-800/30',
    iconColor: 'text-indigo-400',
    title: 'Export Reports',
    description:
      'Generate structured intelligence reports with entity summaries, timelines, and relationship maps.',
    style: { animationDelay: '1s' },
  },
]

export function QuickStartGuide() {
  return (
    <section className="px-8 pb-16">
      <div className="max-w-5xl mx-auto">
        <div className="anim-up d7 flex items-center gap-3 mb-6">
          <div className="w-7 h-7 rounded-lg bg-indigo-950 border border-indigo-800/40 flex items-center justify-center">
            <Compass className="h-3.5 w-3.5 text-indigo-400" />
          </div>
          <h2 className="font-display font-bold text-lg tracking-tight text-slate-50">
            Quick Start
          </h2>
          <div className="flex-1 h-px bg-slate-800 ml-2" />
        </div>

        <div className="grid grid-cols-4 gap-5">
          {steps.map((step) => (
            <div
              key={step.number}
              className={`anim-up ${step.delay} group`}
              style={step.style}
            >
              <div className="neu-card rounded-2xl p-5 h-full">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center text-white font-display font-extrabold text-xs flex-shrink-0 shadow-md shadow-indigo-500/20">
                    {step.number}
                  </div>
                  {step.number < 4 && <div className="flex-1 step-connector" />}
                  {step.number === 4 && (
                    <div className="w-3 h-3 rounded-full bg-indigo-900 flex items-center justify-center flex-shrink-0 ml-auto">
                      <Check className="h-2 w-2 text-indigo-400" />
                    </div>
                  )}
                </div>
                <div
                  className={`w-10 h-10 rounded-xl ${step.bg} flex items-center justify-center mb-3`}
                >
                  <step.icon className={`h-5 w-5 ${step.iconColor}`} />
                </div>
                <h4 className="font-display font-bold text-sm text-slate-50 mb-1.5">
                  {step.title}
                </h4>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  {step.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
