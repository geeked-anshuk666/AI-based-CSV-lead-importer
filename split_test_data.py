import csv
import os

def split_csv():
    input_file = "synthetic_leads_100k.csv"
    chunk_size = 25_000
    
    if not os.path.exists(input_file):
        print(f"Error: '{input_file}' not found. Please run generate_load_test_data.py first.")
        return
        
    print(f"Splitting '{input_file}' into chunks of {chunk_size} rows...")
    
    with open(input_file, 'r', encoding='utf-8') as infile:
        reader = csv.reader(infile)
        headers = next(reader)
        
        chunk_idx = 1
        current_rows = []
        
        for idx, row in enumerate(reader):
            current_rows.append(row)
            if len(current_rows) == chunk_size:
                write_chunk(headers, current_rows, chunk_idx)
                chunk_idx += 1
                current_rows = []
                
        # Write any remaining rows
        if current_rows:
            write_chunk(headers, current_rows, chunk_idx)
            
    print("Successfully split the dataset!")

def write_chunk(headers, rows, chunk_idx):
    output_filename = f"synthetic_leads_100k_part_{chunk_idx}.csv"
    with open(output_filename, 'w', newline='', encoding='utf-8') as outfile:
        writer = csv.writer(outfile)
        writer.writerow(headers)
        writer.writerows(rows)
    print(f"Created: {output_filename} ({len(rows)} leads) - {os.path.getsize(output_filename) / (1024*1024):.2f} MB")

if __name__ == "__main__":
    split_csv()
