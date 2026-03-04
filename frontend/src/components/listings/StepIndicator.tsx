interface Step {
  id: number;
  name: string;
}

interface StepIndicatorProps {
  steps: Step[];
  currentStep: number;
}

export function StepIndicator({ steps, currentStep }: StepIndicatorProps) {
  return (
    <nav aria-label="Progress" className="glass rounded-2xl p-4 mb-6">
      <ol role="list" className="flex items-center justify-between">
        {steps.map((step, stepIdx) => (
          <li key={step.id} className="relative flex-1">
            {stepIdx !== steps.length - 1 && (
              <div
                className="absolute top-4 left-1/2 w-full h-px bg-white/10"
                aria-hidden="true"
              />
            )}
            <div className="relative flex flex-col items-center group">
              {step.id === currentStep && (
                <span className="absolute inset-0 top-0 flex items-start justify-center" aria-hidden="true">
                  <span className="h-8 w-8 bg-gradient-primary rounded-full blur opacity-50" />
                </span>
              )}
              <span
                className={`relative flex h-8 w-8 items-center justify-center rounded-full border-2 transition-colors ${
                  step.id < currentStep
                    ? 'bg-gradient-primary border-transparent'
                    : step.id === currentStep
                    ? 'border-primary-500 bg-dark-700'
                    : 'border-white/10 bg-dark-600'
                }`}
                aria-current={step.id === currentStep ? 'step' : undefined}
              >
                {step.id < currentStep ? (
                  <svg className="h-5 w-5 text-white" viewBox="0 0 20 20" fill="currentColor">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                ) : (
                  <span
                    className={`text-sm font-medium ${
                      step.id === currentStep ? 'text-white' : 'text-gray-400'
                    }`}
                  >
                    {step.id + 1}
                  </span>
                )}
              </span>
              <span
                className={`mt-2 text-xs font-medium ${
                  step.id === currentStep ? 'text-white' : 'text-gray-400'
                }`}
              >
                {step.name}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </nav>
  );
}
