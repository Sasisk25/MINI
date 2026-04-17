import pandas as pd


def load_csv_safe(path, columns=None):
    try:
        return pd.read_csv(path)
    except Exception:
        return pd.DataFrame(columns=columns) if columns else pd.DataFrame()


def append_row(path, row, columns):
    df = load_csv_safe(path, columns=columns)
    df = pd.concat([df, pd.DataFrame([row])], ignore_index=True)
    df.to_csv(path, index=False)
