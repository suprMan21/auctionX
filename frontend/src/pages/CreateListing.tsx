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

  const confirmExit = async () => {
    if (canSaveDraft) {
      await saveDraft();
    }
    resetDraft();
    navigate('/my-listings');
  };

  const handleSaveDraft = async () => {
    if (!canSaveDraft) {
      alert('Please fill in title, category, and condition before saving');
      return;
    }
    
    try {
      await saveDraft();
      alert('Draft saved successfully!');
    } catch (err: any) {
      alert('Failed to save draft: ' + err.message);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white shadow-lg rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex justify-between items-center">
              <h1 className="text-2xl font-bold text-gray-900">
                {id ? 'Edit Listing' : 'Create Listing'}
              </h1>
              <button
                onClick={handleExit}
                className="text-gray-600 hover:text-gray-900"
                aria-label="Exit listing creation"
              >
                Exit
              </button>
            </div>
          </div>

          <StepIndicator steps={STEPS} currentStep={draft.current_step} />

          <div className="px-6 py-8">
            <CurrentStepComponent />
          </div>

          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-between">
            <button
              onClick={handlePrevious}
              disabled={draft.current_step === 0}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            
            <button
              onClick={handleSaveDraft}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Save Draft
            </button>

            <button
              onClick={handleNext}
              disabled={draft.current_step === STEPS.length - 1}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {showExitModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md mx-4">
            <h2 className="text-lg font-semibold mb-4">Unsaved Changes</h2>
            <p className="text-gray-600 mb-6">
              You have unsaved changes. Would you like to save your draft before exiting?
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowExitModal(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  resetDraft();
                  navigate('/my-listings');
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700"
              >
                Discard
              </button>
              <button
                onClick={confirmExit}
                disabled={!canSaveDraft}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Save & Exit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
