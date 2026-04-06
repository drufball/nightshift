import { afterEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPicker } from './command-picker';

afterEach(cleanup);

const items = [{ name: 'alpha/' }, { name: 'beta/' }, { name: 'gamma/' }];

describe('CommandPicker', () => {
  describe('rendering', () => {
    it('shows all items', () => {
      render(<CommandPicker items={items} onSelect={mock()} />);
      // getByText throws if the element is absent — sufficient for presence assertion
      screen.getByText('alpha/');
      screen.getByText('beta/');
      screen.getByText('gamma/');
    });

    it('shows meta text when provided', () => {
      render(
        <CommandPicker
          items={[{ name: 'alpha/', meta: 'lead +2' }]}
          onSelect={mock()}
        />,
      );
      screen.getByText('lead +2');
    });

    it('shows create button when onCreate provided', () => {
      render(
        <CommandPicker
          items={items}
          onSelect={mock()}
          createLabel="new team"
          onCreate={mock()}
        />,
      );
      screen.getByText('+ new team');
    });

    it('omits create button when onCreate not provided', () => {
      render(<CommandPicker items={items} onSelect={mock()} />);
      expect(screen.queryByText(/^\+/)).toBeNull();
    });
  });

  describe('filtering', () => {
    it('filters items by query', async () => {
      const user = userEvent.setup();
      render(<CommandPicker items={items} onSelect={mock()} />);

      await user.type(screen.getByPlaceholderText('filter...'), 'al');

      screen.getByText('alpha/');
      expect(screen.queryByText('beta/')).toBeNull();
      expect(screen.queryByText('gamma/')).toBeNull();
    });

    it('is case-insensitive', async () => {
      const user = userEvent.setup();
      render(<CommandPicker items={items} onSelect={mock()} />);

      await user.type(screen.getByPlaceholderText('filter...'), 'BETA');

      screen.getByText('beta/');
      expect(screen.queryByText('alpha/')).toBeNull();
    });

    it('shows no-matches message when filter has no results', async () => {
      const user = userEvent.setup();
      render(<CommandPicker items={items} onSelect={mock()} />);

      await user.type(screen.getByPlaceholderText('filter...'), 'zzz');

      screen.getByText('(no matches)');
    });
  });

  describe('keyboard navigation', () => {
    it('selects item at cursor on Enter', async () => {
      const user = userEvent.setup();
      const onSelect = mock();
      render(<CommandPicker items={items} onSelect={onSelect} />);

      await user.keyboard('{Enter}');

      expect(onSelect).toHaveBeenCalledWith(0);
    });

    it('moves cursor down with ArrowDown', async () => {
      const user = userEvent.setup();
      const onSelect = mock();
      render(<CommandPicker items={items} onSelect={onSelect} />);

      await user.keyboard('{ArrowDown}{Enter}');

      expect(onSelect).toHaveBeenCalledWith(1);
    });

    it('moves cursor up with ArrowUp', async () => {
      const user = userEvent.setup();
      const onSelect = mock();
      render(<CommandPicker items={items} onSelect={onSelect} />);

      await user.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}{Enter}');

      expect(onSelect).toHaveBeenCalledWith(1);
    });

    it('does not move cursor below last item', async () => {
      const user = userEvent.setup();
      const onSelect = mock();
      render(<CommandPicker items={items} onSelect={onSelect} />);

      // ArrowDown many times — should clamp at last item (index 2)
      await user.keyboard(
        '{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{Enter}',
      );

      expect(onSelect).toHaveBeenCalledWith(2);
    });

    it('does not move cursor above first item', async () => {
      const user = userEvent.setup();
      const onSelect = mock();
      render(<CommandPicker items={items} onSelect={onSelect} />);

      await user.keyboard('{ArrowUp}{Enter}');

      expect(onSelect).toHaveBeenCalledWith(0);
    });

    it('calls onClose on Escape', async () => {
      const user = userEvent.setup();
      const onClose = mock();
      render(
        <CommandPicker items={items} onSelect={mock()} onClose={onClose} />,
      );

      await user.keyboard('{Escape}');

      expect(onClose).toHaveBeenCalled();
    });

    it('passes original index when filtered', async () => {
      const user = userEvent.setup();
      const onSelect = mock();
      render(<CommandPicker items={items} onSelect={onSelect} />);

      await user.type(screen.getByPlaceholderText('filter...'), 'bet');
      await user.keyboard('{Enter}');

      // 'beta/' is index 1 in the original items array
      expect(onSelect).toHaveBeenCalledWith(1);
    });

    it('resets cursor to 0 when filter changes', async () => {
      const user = userEvent.setup();
      const onSelect = mock();
      render(<CommandPicker items={items} onSelect={onSelect} />);

      // Move down to beta, then filter — cursor should reset
      await user.keyboard('{ArrowDown}');
      await user.type(screen.getByPlaceholderText('filter...'), 'al');
      await user.keyboard('{Enter}');

      expect(onSelect).toHaveBeenCalledWith(0); // alpha/ is index 0
    });
  });

  describe('mouse interaction', () => {
    it('selects item on click', async () => {
      const user = userEvent.setup();
      const onSelect = mock();
      render(<CommandPicker items={items} onSelect={onSelect} />);

      await user.click(screen.getByText('gamma/'));

      expect(onSelect).toHaveBeenCalledWith(2);
    });

    it('updates cursor on hover', async () => {
      const user = userEvent.setup();
      const onSelect = mock();
      render(<CommandPicker items={items} onSelect={onSelect} />);

      await user.hover(screen.getByText('gamma/'));
      await user.keyboard('{Enter}');

      expect(onSelect).toHaveBeenCalledWith(2);
    });
  });

  describe('create flow', () => {
    it('switches to create mode on button click', async () => {
      const user = userEvent.setup();
      render(
        <CommandPicker
          items={items}
          onSelect={mock()}
          createLabel="new team"
          onCreate={mock()}
        />,
      );

      await user.click(screen.getByText('+ new team'));

      screen.getByPlaceholderText('new team');
      screen.getByText('name:');
    });

    it('calls onCreate with trimmed name on Enter', async () => {
      const user = userEvent.setup();
      const onCreate = mock();
      render(
        <CommandPicker
          items={items}
          onSelect={mock()}
          createLabel="new team"
          onCreate={onCreate}
        />,
      );

      await user.click(screen.getByText('+ new team'));
      await user.type(screen.getByPlaceholderText('new team'), '  my team  ');
      await user.keyboard('{Enter}');

      expect(onCreate).toHaveBeenCalledWith('my team');
    });

    it('does not call onCreate on Enter with empty name', async () => {
      const user = userEvent.setup();
      const onCreate = mock();
      render(
        <CommandPicker
          items={items}
          onSelect={mock()}
          createLabel="new team"
          onCreate={onCreate}
        />,
      );

      await user.click(screen.getByText('+ new team'));
      await user.keyboard('{Enter}');

      expect(onCreate).not.toHaveBeenCalled();
    });

    it('returns to list on Escape in create mode', async () => {
      const user = userEvent.setup();
      render(
        <CommandPicker
          items={items}
          onSelect={mock()}
          createLabel="new team"
          onCreate={mock()}
        />,
      );

      await user.click(screen.getByText('+ new team'));
      expect(screen.queryByPlaceholderText('filter...')).toBeNull();

      await user.keyboard('{Escape}');

      screen.getByPlaceholderText('filter...');
    });
  });
});
