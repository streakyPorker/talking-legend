import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from '../App.js';

describe('App', () => {
  it('should render the game setup screen initially', () => {
    render(<App />);

    expect(screen.getByText('Talking Legend')).toBeDefined();
    expect(screen.getByLabelText(/what is your name/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /begin your legend/i })).toBeDefined();
  });
});
