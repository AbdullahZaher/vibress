import {
  AVATAR_REGISTRY,
  MemberAvatarKey,
  AvatarItem,
} from "../lib/avatars";

interface AvatarPickerProps {
  selectedKey: MemberAvatarKey;
  onSelect: (key: MemberAvatarKey) => void;
  disabled?: boolean;
}

export function AvatarPicker({
  selectedKey,
  onSelect,
  disabled = false,
}: AvatarPickerProps) {
  return (
    <div
      className="ap-avatar-grid"
      role="radiogroup"
      aria-label="Choose your avatar"
    >
      {AVATAR_REGISTRY.map((item: AvatarItem) => {
        const isSelected = selectedKey === item.key;
        return (
          <button
            key={item.key}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-label={`${item.name} avatar`}
            disabled={disabled}
            onClick={() => onSelect(item.key)}
            className={`ap-avatar-option ${isSelected ? "is-selected" : ""}`}
          >
            <div className="ap-avatar-preview-wrap">
              <img
                src={item.url}
                alt={item.name}
                className="ap-avatar-preview-img"
                loading="lazy"
                decoding="async"
                width={56}
                height={56}
              />
              {isSelected && (
                <div className="ap-avatar-check" aria-hidden="true">
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
              )}
            </div>
            <span className="ap-avatar-name">{item.name}</span>
          </button>
        );
      })}
    </div>
  );
}
