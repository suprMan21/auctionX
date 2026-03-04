import { useListingCreation } from '../../../stores/listingCreationStore';
import { CategoryBrowser } from '../CategoryBrowser';

export function CategoryStep() {
  const { draft, setCategory } = useListingCreation();

  const handleCategorySelect = (category: any) => {
    console.log('Category selected:', category);
    setCategory(category.id);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-medium text-white mb-4">Select Category</h2>
        <p className="text-sm text-gray-400 mb-4">
          Choose the most specific category for your item. Only leaf categories (without sub-categories) can be selected.
        </p>
      </div>

      <CategoryBrowser
        selectedCategoryId={draft.category_id}
        onSelect={handleCategorySelect}
      />

      {draft.category_id && (
        <div className="mt-4 p-4 bg-success-500/10 border border-success-500/30 rounded-xl">
          <p className="text-sm font-medium text-success-400">
            ✓ Category selected
          </p>
        </div>
      )}
    </div>
  );
}
