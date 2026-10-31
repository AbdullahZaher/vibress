import { ListFilter } from "lucide-react";
import { EditorialChoiceMenu, type EditorialChoice } from "./EditorialChoiceMenu";

export type EditorialStatusOption = EditorialChoice;
interface EditorialStatusFilterProps {
  label: string;
  options: readonly EditorialStatusOption[];
  value: string;
  onChange: (value: string) => void;
}

/** Filter options stay concealed until the user opens them. */
export function EditorialStatusFilter({ label, options, value, onChange }: EditorialStatusFilterProps) {
  return (
    <EditorialChoiceMenu
      label={label}
      options={options}
      value={value}
      onChange={onChange}
      active={value !== "all"}
      icon={<ListFilter className="size-4" aria-hidden="true" />}
    />
  );
}
