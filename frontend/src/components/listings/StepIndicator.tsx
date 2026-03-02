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
    <nav aria-label="Progress" className="px-6 py-4 bg-gray-50 border-b border-gray-200">
      <ol role="list" className="flex items-center justify-between">
        {steps.map((step, stepIdx) => (
          <li key={step.id} className="relative flex-1">
            {stepIdx !== steps.length - 1 && (
              <div
                className="absolute top-4 left-1/2 w-full h-0.5 bg-gray-200"
                aria-hidden="true"
              />
            )}
            <div className="relative flex flex-col items-center group">
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full border-2 transition-colors ${
                  step.id < currentStep
                    ? 'bg-blue-600 border-blue-600'
                    : step.id === currentStep
                    ? 'border-blue-600 bg-white'
                    : 'border-gray-300 bg-white'
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
                      step.id === currentStep ? 'text-blue-600' : 'text-gray-500'
                    }`}
                  >
                    {step.id + 1}
                  </span>
                )}
              </span>
              <span
                className={`mt-2 text-xs font-medium ${
                  step.id === currentStep ? 'text-blue-600' : 'text-gray-500'
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
