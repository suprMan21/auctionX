import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useListingCreation } from '../stores/listingCreationStore';
import { StepIndicator } from '../components/listings/StepIndicator';
import { BasicInfoStep } from '../components/listings/steps/BasicInfoStep';
import { CategoryStep } from '../components/listings/steps/CategoryStep';
import { MediaStep } from '../components/listings/steps/MediaStep';
import { PricingStep } from '../components/listings/steps/PricingStep';
import { LocationStep } from '../components/listings/steps/LocationStep';
import { ReviewStep } from '../components/listings/steps/ReviewStep';

const STEPS = [
  { id: 0, name: 'Basic Info', component: BasicInfoStep },
  { id: 1, name: 'Category', component: CategoryStep },
  { id: 2, name: 'Media', component: MediaStep },
  { id: 3, name: 'Pricing', component: PricingStep },
  { id: 4, name: 'Location', component: LocationStep },
  { id: 5, name: 'Review', component: ReviewStep },
];

export function CreateListing() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { draft, isDirty, saveDraft, resetDraft, loadDraft, setCurrentStep } = useListingCreation();
  const [showExitModal, setShowExitModal] = useState(false);

  const currentStepData = STEPS[draft.current_step];
  const CurrentStepComponent = currentStepData.component;

  const canSaveDraft = draft.title && draft.category_id && draft.condition;

  useEffect(() => {
    if (id) {
      loadDraft(id);
    } else {
      resetDraft();
    }
  }, [id]);

  useEffect(() => {
    const autoSaveInterval = setInterval(() => {
      if (isDirty && canSaveDraft) {
        saveDraft().catch(err => {
          console.error('Auto-save failed:', err);
        });
      }
    }, 30000);

    return () => clearInterval(autoSaveInterval);
  }, [isDirty, canSaveDraft]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  const handleNext = () => {
    if (draft.current_step < STEPS.length - 1) {
      setCurrentStep(draft.current_step + 1);
    }
  };

  const handlePrevious = () => {
    if (draft.current_step > 0) {
      setCurrentStep(draft.current_step - 1);
    }
  };

  const handleExit = () => {
    if (isDirty) {
      setShowExitModal(true);
    } else {
      resetDraft();
      navigate('/my-listings');
    }
  };

  const handleSaveAndExit = async () => {
    if (canSaveDraft) {
      await saveDraft();
    }
    resetDraft();
    navigate('/my-listings');
  };

  const handleDiscardAndExit = () => {
    resetDraft();
    navigate('/my-listings');
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <main role="main" className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <header className="mb-8">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-3xl font-bold text-gray-900">
              {id ? 'Edit Listing' : 'Create New Listing'}
            </h1>
            <button
              onClick={handleExit}
              className="text-gray-600 hover:text-gray-900"
              aria-label="Exit listing creation"
            >
              Exit
            </button>
          </div>

          <StepIndicator steps={STEPS} currentStep={draft.current_step} />
        </header>

        <section aria-labelledby="step-heading" className="bg-white rounded-lg shadow p-6">
          <h2 id="step-heading" className="text-xl font-semibold mb-6">
            {currentStepData.name}
          </h2>
          
          <CurrentStepComponent />

          <nav className="mt-8 flex justify-between" aria-label="Listing creation navigation">
            <button
              onClick={handlePrevious}
              disabled={draft.current_step === 0}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            
            <button
              onClick={handleNext}
              disabled={draft.current_step === STEPS.length - 1}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </nav>
        </section>

        {showExitModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50" role="dialog" aria-labelledby="exit-dialog-title" aria-describedby="exit-dialog-description">
            <div className="bg-white rounded-lg max-w-md w-full p-6">
              <h2 id="exit-dialog-title" className="text-xl font-bold mb-4">Unsaved Changes</h2>
              <p id="exit-dialog-description" className="text-gray-600 mb-6">
                You have unsaved changes. What would you like to do?
              </p>
              <div className="flex space-x-3">
                <button
                  onClick={handleSaveAndExit}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                  disabled={!canSaveDraft}
                >
                  Save & Exit
                </button>
                <button
                  onClick={handleDiscardAndExit}
                  className="flex-1 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
                >
                  Discard
                </button>
                <button
                  onClick={() => setShowExitModal(false)}
                  className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
