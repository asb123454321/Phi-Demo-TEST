open F,"<:utf8","c.txt"; my @ev;
while(<F>){ s/\x{feff}//g; next unless /\S/; my @p=split; push @ev,[$p[0],$p[2]+0,$p[3]+0,$p[4]+0,$p[5]+0,$p[6]+0]; }
my %hit; my $tot=0; my $hitc=0;
for my $a (@ev){ next if $a->[2]-$a->[1] > 1; $tot++;
  for my $b (@ev){ next if $b==$a; next if $b->[2]-$b->[1]>1;
    next unless abs($a->[1]-$b->[1])<1e-6;
    next unless abs($a->[3]-$b->[3])<1e-4;  # same x
    if(($a->[4]>0 && $b->[4]<0)||($a->[4]<0 && $b->[4]>0)){ $hitc++; last }
  }
}
print "notes(single) $tot, having opposite-direction twin same x/time: $hitc\n";
