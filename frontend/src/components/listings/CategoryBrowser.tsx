import { useState, useEffect } from 'react';
import { supabase } from '../../features/auth/lib/supabase';

interface Category {
  id: string;
  name: string;
  parent_id: string | null;
  brand_restriction: 'AUCTIONX' | 'UNMENTIONABLES' | null;
  is_nsfw: boolean;
  sort_order: number;
  children?: Category[];
}

interface CategoryBrowserProps {
  selectedCategoryId: string | null;
  onSelect: (category: Category) => void;
}

export function CategoryBrowser({ selectedCategoryId, onSelect }: CategoryBrowserProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [brandFilter, setBrandFilter] = useState<'AUCTIONX' | 'UNMENTIONABLES'>('AUCTIONX');

  useEffect(() => {
    loadCategories();
  }, [brandFilter]);

  const loadCategories = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .or(`brand_restriction.eq.${brandFilter},brand_restriction.is.null`)
      .order('sort_order', { ascending: true });

    if (!error && data) {
      setCategories(data);
    }
    setLoading(false);
  };

  const toggleNode = (categoryId: string) => {
    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(categoryId)) {
      newExpanded.delete(categoryId);
    } else {
      newExpanded.add(categoryId);
    }
    setExpandedNodes(newExpanded);
  };

  const buildTree = (parentId: string | null = null): Category[] => {
    return categories
      .filter(cat => cat.parent_id === parentId)
      .filter(cat => 
        searchQuery === '' || 
        cat.name.toLowerCase().includes(searchQuery.toLowerCase())
      );
  };

  const hasChildren = (categoryId: string): boolean => {
    return categories.some(cat => cat.parent_id === categoryId);
  };

  const isLeafNode = (category: Category): boolean => {
    return !hasChildren(category.id);
  };

  const renderCategory = (category: Category, depth: number = 0) => {
    const children = buildTree(category.id);
    const isExpanded = expandedNodes.has(category.id);
    const isSelected = selectedCategoryId === category.id;
    const isLeaf = isLeafNode(category);

    return (
      <div key={category.id} style={{ marginLeft: `${depth * 20}px` }}>
        <button
          onClick={() => {
            if (children.length > 0) {
              toggleNode(category.id);
            } else if (isLeaf) {
              onSelect(category);
            }
          }}
          disabled={!isLeaf && children.length === 0}
          className={`w-full text-left px-3 py-2 rounded-md flex items-center justify-between transition-colors ${
            isSelected
              ? 'bg-blue-100 text-blue-900'
              : isLeaf
              ? 'hover:bg-gray-100 text-gray-900'
              : 'text-gray-600 cursor-default'
          }`}
          aria-expanded={children.length > 0 ? isExpanded : undefined}
        >
          <div className="flex items-center space-x-2">
            {children.length > 0 && (
              <svg
                className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            )}
            <span className={isLeaf ? 'font-medium' : 'font-normal'}>
              {category.name}
            </span>
          </div>
          {isLeaf && (
            <span className="text-xs text-gray-500">Selectable</span>
          )}
        </button>
        
        {children.length > 0 && isExpanded && (
          <div className="mt-1">
            {children.map(child => renderCategory(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const rootCategories = buildTree(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center space-x-4">
        <div className="flex-1">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search categories..."
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Search categories"
          />
        </div>
        <div className="flex space-x-2">
          <button
            onClick={() => setBrandFilter('AUCTIONX')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              brandFilter === 'AUCTIONX'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            AuctionX
          </button>
          <button
            onClick={() => setBrandFilter('UNMENTIONABLES')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              brandFilter === 'UNMENTIONABLES'
                ? 'bg-purple-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            Unmentionables
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8 text-gray-500">Loading categories...</div>
      ) : (
        <div 
          className="border border-gray-300 rounded-md p-4 max-h-96 overflow-y-auto"
          role="tree"
          aria-label="Category tree"
        >
          {rootCategories.map(category => renderCategory(category))}
        </div>
      )}
    </div>
  );
}
