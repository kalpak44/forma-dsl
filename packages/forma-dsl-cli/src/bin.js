#!/usr/bin/env node
/**
 * The executable: one invocation of the command line, and the exit code it answers with.
 *
 * Everything this file does beyond supplying the real streams lives in `cli.js`, which is
 * what the tests drive - a `run` that returns an exit code can be asserted on, and one that
 * calls `process.exit` cannot.
 *
 * stdout carries only what was asked for: the STL when `-o -` was given, and the listings.
 * The summary and every diagnostic go to stderr, so the pipe stays clean.
 */
import { run } from './cli.js';

process.exitCode = await run(process.argv.slice(2), { out: process.stdout, err: process.stderr });
