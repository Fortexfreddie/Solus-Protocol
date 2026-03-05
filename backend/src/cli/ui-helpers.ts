import chalk from 'chalk';

export const THEME = {
    rex: chalk.red.bold,
    nova: chalk.blue.bold,
    sage: chalk.green.bold,
    dim: chalk.dim,
    label: chalk.cyan,
    success: chalk.green,
    error: chalk.red,
    warning: chalk.yellow,
    highlight: chalk.magenta.bold,
    header: chalk.bgCyan.black.bold,
};

export function div(char = '─', width = 80): string {
    return THEME.dim(char.repeat(width));
}

export function formatTimestamp(): string {
    return THEME.dim(`[${new Date().toLocaleTimeString()}] `);
}