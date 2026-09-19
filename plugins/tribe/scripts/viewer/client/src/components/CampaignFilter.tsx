// client/src/components/CampaignFilter.tsx — the filter box (spec §8.1). A plain controlled
// input: it holds no state and decides no matching itself (`SessionList#filterSessionsByCampaign`
// owns the matching rule, spec §9) — a badge click elsewhere fills `value` by writing
// `?campaign=<repoKey>/<slug>` to the address bar (`CampaignBadge`), and a later task reads that
// query param back into this component's `value` prop.
export interface CampaignFilterProps {
  value: string;
  onChange: (value: string) => void;
}

export function CampaignFilter({ value, onChange }: CampaignFilterProps) {
  return (
    <input
      type="text"
      className="campaign-filter"
      placeholder="filter by campaign (repoKey/slug)"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
