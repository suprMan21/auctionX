import { useListingCreation } from '../../../stores/listingCreationStore';

const CONDITIONS = [
  { value: 'NEW', label: 'New', description: 'Never used, in original packaging' },
  { value: 'LIKE_NEW', label: 'Like New', description: 'Minimal use, excellent condition' },
  { value: 'EXCELLENT', label: 'Excellent', description: 'Lightly used, no visible wear' },
  { value: 'GOOD', label: 'Good', description: 'Used with minor signs of wear' },
  { value: 'FAIR', label: 'Fair', description: 'Visible wear, fully functional' },
  { value: 'POOR', label: 'Poor', description: 'Heavy wear, may have issues' },
];

export function BasicInfoStep() {
  const { draft, setTitle, setDescription, setCondition } = useListingCreation();

  return (
    <div className="space-y-6">
      <div>
        <label htmlFor="title" className="block text-sm font-medium text-gray-300 mb-1.5">
          Title <span className="text-error-500">*</span>
        </label>
        <input
          type="text"
          id="title"
          value={draft.title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={160}
          className="w-full bg-dark-600 text-white border border-transparent rounded-xl px-4 py-3 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
          placeholder="e.g., Vintage Nike Air Jordan 1 Sneakers"
          required
          aria-required="true"
        />
        <p className="mt-1 text-xs text-gray-400">{draft.title.length}/160 characters</p>
      </div>

      <div>
        <label htmlFor="description" className="block text-sm font-medium text-gray-300 mb-1.5">
          Description
        </label>
        <textarea
          id="description"
          value={draft.description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={5000}
          rows={6}
          className="w-full bg-dark-600 text-white border border-transparent rounded-xl px-4 py-3 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
          placeholder="Describe your item in detail..."
        />
        <p className="mt-1 text-xs text-gray-400">{draft.description.length}/5000 characters</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-3">
          Condition <span className="text-error-500">*</span>
        </label>
        <div className="space-y-2" role="radiogroup" aria-label="Item condition">
          {CONDITIONS.map((condition) => (
            <label
              key={condition.value}
              className={`flex items-start p-3 border rounded-xl cursor-pointer transition-colors ${
                draft.condition === condition.value
                  ? 'border-primary-500 bg-primary-500/10'
                  : 'border-white/10 hover:border-white/20'
              }`}
            >
              <input
                type="radio"
                name="condition"
                value={condition.value}
                checked={draft.condition === condition.value}
                onChange={(e) => setCondition(e.target.value)}
                className="mt-1 h-4 w-4 text-primary-500 focus:ring-primary-500 bg-dark-600 border-white/20"
                aria-describedby={`condition-${condition.value}-description`}
              />
              <div className="ml-3">
                <span className="block text-sm font-medium text-white">{condition.label}</span>
                <span
                  id={`condition-${condition.value}-description`}
                  className="block text-xs text-gray-400"
                >
                  {condition.description}
                </span>
              </div>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
