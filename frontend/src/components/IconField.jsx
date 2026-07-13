import Icon from './Icon'

// An input (or textarea) with a Lucide leading icon, using field treatment C.
// The icon color defaults to terra (form fields) but callers pass their own —
// search fields use ink-soft. Any extra props (value, onChange, type, etc.)
// forward to the underlying control.
export default function IconField({
  icon,
  iconClassName = 'text-terra',
  className = '',
  wrapperClassName = '',
  ...props
}) {
  return (
    <div className={`relative ${wrapperClassName}`}>
      <span
        className={`absolute left-3 top-1/2 -translate-y-1/2 ${iconClassName}`}
      >
        <Icon name={icon} className="w-[17px] h-[17px]" />
      </span>
      <input className={`field field--icon ${className}`} {...props} />
    </div>
  )
}
