"""Job handlers. Each handler is responsible for taking a leased job, calling
back into the API for context, running the ML pipeline, and reporting the
result via succeed / fail."""
