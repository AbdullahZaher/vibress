import React from 'react';

export interface UnsplashIconProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string;
}

export const UnsplashIcon: React.FC<UnsplashIconProps> = ({
  size,
  className = 'w-3.5 h-3.5',
  ...props
}) => {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      {...props}
    >
      <path d="M7.5 6.75V0h9v6.75h-9zm9 3.75H24V24H0V10.5h7.5v6.75h9V10.5z" />
    </svg>
  );
};

