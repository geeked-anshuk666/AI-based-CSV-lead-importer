import csv
import uuid
import random
import os

def main():
    input_file = "SampleData.csv"
    output_file = "synthetic_leads_100k.csv"
    total_records = 100_000
    duplicate_ratio = 0.20  # 20% duplicates
    
    if not os.path.exists(input_file):
        print(f"Error: Input file '{input_file}' not found.")
        return
        
    print(f"Reading base samples from '{input_file}'...")
    base_rows = []
    headers = []
    
    with open(input_file, mode='r', encoding='utf-8', errors='ignore') as infile:
        reader = csv.reader(infile)
        headers = next(reader)
        for row in reader:
            if row:
                base_rows.append(row)
                
    print(f"Loaded {len(base_rows)} base rows from SampleData.csv.")
    
    # Check if Email column exists, if not append it
    email_idx = -1
    for idx, h in enumerate(headers):
        if 'email' in h.lower() or 'mail' in h.lower():
            email_idx = idx
            break
            
    if email_idx == -1:
        headers.append("Email")
        email_idx = len(headers) - 1
        # Add an empty column to each base row to match new headers length
        for r in base_rows:
            r.append("")
            
    # Find key column indices
    prospect_id_idx = -1
    lead_number_idx = -1
    mobile_idx = -1
    company_idx = -1
    
    for idx, h in enumerate(headers):
        h_lower = h.lower()
        if 'prospect id' in h_lower:
            prospect_id_idx = idx
        elif 'lead number' in h_lower:
            lead_number_idx = idx
        elif 'mobile number' in h_lower or 'phone' in h_lower:
            mobile_idx = idx
        elif 'company' in h_lower:
            company_idx = idx
            
    print("Generating 100,000 synthetic records...")
    
    # List to store unique generated rows for referencing duplicates
    uniques_pool = []
    
    with open(output_file, mode='w', encoding='utf-8', newline='') as outfile:
        writer = csv.writer(outfile)
        writer.writerow(headers)
        
        for i in range(total_records):
            is_duplicate = len(uniques_pool) > 0 and random.random() < duplicate_ratio
            
            if is_duplicate:
                # Select a random lead from our uniques pool to duplicate
                source_row = list(random.choice(uniques_pool))
                # Optionally change non-unique details like notes to simulate updates
                writer.writerow(source_row)
            else:
                # Create a new unique lead based on a random row template
                template_row = list(random.choice(base_rows))
                
                # Replace identifying details with unique synthetic values
                if prospect_id_idx != -1:
                    template_row[prospect_id_idx] = str(uuid.uuid4())
                if lead_number_idx != -1:
                    template_row[lead_number_idx] = str(700000 + i)
                if mobile_idx != -1:
                    template_row[mobile_idx] = f"+9199999{i:05d}"
                if company_idx != -1:
                    template_row[company_idx] = f"Test Enterprise LLC {i}"
                    
                # Always generate a unique email
                template_row[email_idx] = f"lead_test_user_{i}@groweasy.ai"
                
                writer.writerow(template_row)
                
                # Keep a small sliding window of uniques (last 2000) to pull duplicates from
                # to save memory during 100K run
                uniques_pool.append(template_row)
                if len(uniques_pool) > 2000:
                    uniques_pool.pop(0)
                    
            if (i + 1) % 20000 == 0:
                print(f"Generated {i + 1} / {total_records} rows...")
                
    print(f"Success! Generated {total_records} records in '{output_file}'.")
    print(f"File size: {os.path.getsize(output_file) / (1024*1024):.2f} MB")

if __name__ == "__main__":
    main()
