import { useSyncExternalStore } from 'react';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { getServerSnapshot, getSnapshot, setTheme, subscribe, type Theme } from '@/lib/account-store';

const options: { value: Theme; label: string; Icon: typeof Sun }[] = [
  { value: 'light', label: 'Claro', Icon: Sun },
  { value: 'dark', label: 'Oscuro', Icon: Moon },
  { value: 'system', label: 'Sistema', Icon: Monitor },
];

/** Selector de tema con botón icono (Claro / Oscuro / Sistema). */
export default function ThemeToggle() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const active = options.find(o => o.value === state.preferences.theme) || options[2];
  const ActiveIcon = active.Icon;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label={`Tema actual: ${active.label}. Abrir selector de tema`}>
          <ActiveIcon aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" aria-label="Selector de tema">
        {options.map(({ value, label, Icon }) => (
          <DropdownMenuItem key={value} onSelect={() => setTheme(value)}>
            <Icon aria-hidden="true" />
            {label}
            {value === active.value && <Check aria-hidden="true" className="ml-auto" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
