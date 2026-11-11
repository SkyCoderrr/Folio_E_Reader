import type { ButtonHTMLAttributes } from 'react';
import clsx from 'clsx';
import styles from './kit.module.css';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
}

/** 32 px button; `:active` scales to 0.97 (PRD 6.6). */
export function Button({
  variant = 'secondary',
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  return <button type={type} className={clsx(styles.btn, styles[variant], className)} {...rest} />;
}
